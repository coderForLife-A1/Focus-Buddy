import json
import os
import re
import secrets
import time
import base64
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from urllib.parse import quote, urlparse
from urllib import error as urlerror
from urllib import request as urlrequest

import msal
from dotenv import load_dotenv
from flask import Flask, jsonify, redirect, request, session
from supabase import Client, create_client

load_dotenv()
load_dotenv(Path(__file__).resolve().parent / ".env")

app = Flask(__name__)
app.secret_key = (os.getenv("FLASK_SECRET_KEY") or os.getenv("SESSION_SECRET") or "dev-secret-change-me").strip()
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = os.getenv("SESSION_COOKIE_SAMESITE", "Lax")
app.config["SESSION_COOKIE_SECURE"] = (os.getenv("SESSION_COOKIE_SECURE", "false").strip().lower() == "true")
app.config["SESSION_REFRESH_EACH_REQUEST"] = False

INTENT_MODEL = "openrouter/free"
SUMMARIZE_MODEL = "qwen/qwen3.6-plus:free"
HUMANIZE_MODEL = "arcee-ai/trinity-large-preview:free"
CHAT_MODEL = "openrouter/free"
OPENROUTER_FREE_MODEL = "openrouter/free"

CIPHER_PERSONA_PROMPT = (
    "You are Cipher, a brutally honest and logical engineering mentor. "
    "Be direct, concise, and actionable. No fluff. No motivational filler. "
    "Do not say phrases like 'I'm happy to help'. "
    "If the user is procrastinating, avoiding execution, or wasting time, call it out clearly "
    "and redirect them to the next concrete step."
)

_microsoft_token_cache: Dict[str, Dict[str, Any]] = {}
_MICROSOFT_SESSION_TABLE = "microsoft_auth_sessions"


def _is_truthy_env(var_name: str, default: bool = False) -> bool:
    raw_value = os.getenv(var_name)
    if raw_value is None:
        return default
    return str(raw_value).strip().lower() in {"1", "true", "yes", "on"}


def _initialize_supabase_client() -> Client:
    supabase_url = (os.environ.get("SUPABASE_URL") or "").strip()
    supabase_key = (
        (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
        or (os.environ.get("SUPABASE_KEY") or "").strip()
        or (os.environ.get("SUPABASE_ANON_KEY") or "").strip()
    )

    missing_vars = []
    if not supabase_url:
        missing_vars.append("SUPABASE_URL")
    if not supabase_key:
        missing_vars.append("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY")

    if missing_vars:
        raise RuntimeError(
            f"Missing required environment variables for Supabase: {', '.join(missing_vars)}"
        )

    # The Python Supabase client expects JWT-style keys (anon/service_role),
    # not sb_publishable_* browser keys.
    if supabase_key.startswith("sb_publishable_"):
        raise RuntimeError(
            "Invalid Supabase key for backend: got sb_publishable_* key. "
            "Set SUPABASE_SERVICE_ROLE_KEY (recommended) or SUPABASE_ANON_KEY/SUPABASE_KEY with a JWT-style key from Supabase project settings."
        )

    try:
        return create_client(supabase_url, supabase_key)
    except Exception as exc:
        raise RuntimeError(f"Failed to initialize Supabase client: {exc}") from exc


_supabase_client: Optional[Client] = None
_supabase_init_error: Optional[str] = None


def _ensure_supabase_client() -> Client:
    global _supabase_client, _supabase_init_error

    if _supabase_client is not None:
        return _supabase_client

    if _supabase_init_error is not None:
        raise RuntimeError(_supabase_init_error)

    try:
        _supabase_client = _initialize_supabase_client()
        return _supabase_client
    except Exception as exc:
        _supabase_init_error = str(exc)
        raise


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json_error(message: str, status_code: int = 400, details: Optional[Dict[str, Any]] = None):
    payload: Dict[str, Any] = {"error": message}
    if details is not None:
        payload["details"] = details
    return jsonify(payload), status_code


def _read_json() -> Dict[str, Any]:
    parsed = request.get_json(silent=True)
    return parsed if isinstance(parsed, dict) else {}


def _split_sentences(text: str):
    normalized = re.sub(r"\s+", " ", str(text or "")).strip()
    if not normalized:
        return []
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", normalized) if s.strip()]


def _fallback_extract_summary(text: str, ratio_percent: float) -> Dict[str, Any]:
    sentences = _split_sentences(text)
    if not sentences:
        return {
            "summary": "",
            "sourceSentences": 0,
            "summarySentences": 0,
            "sourceWords": 0,
        }

    source_words = len(re.findall(r"\b[\w']+\b", text))
    target_count = max(1, min(12, round((ratio_percent / 100.0) * len(sentences))))
    picked = sentences[:target_count]

    return {
        "summary": " ".join(picked),
        "sourceSentences": len(sentences),
        "summarySentences": len(picked),
        "sourceWords": source_words,
    }


def _build_local_summary_response(local_summary: Dict[str, Any], warning: str, ai_error: Optional[Dict[str, Any]] = None):
    response: Dict[str, Any] = {
        "summary": local_summary["summary"],
        "sourceSentences": local_summary["sourceSentences"],
        "summarySentences": local_summary["summarySentences"],
        "sourceWords": local_summary["sourceWords"],
        "usedFallback": True,
        "provider": "local",
        "warning": warning,
    }
    if ai_error:
        response["aiError"] = ai_error
    return response


def _infer_ai_provider(api_key: str) -> str:
    configured_provider = os.getenv("AI_PROVIDER", "").strip().lower()
    if configured_provider == "openrouter":
        return configured_provider

    if api_key.startswith("sk-or-v1-"):
        return "openrouter"

    return "openrouter"


def _get_ai_api_key() -> str:
    openrouter_key = (os.environ.get("OPENROUTER_API_KEY") or "").strip()
    if openrouter_key:
        return openrouter_key

    return ""


def _openrouter_chat_completion_with_fallback(
    api_key: str,
    primary_model: str,
    messages: list[Dict[str, str]],
    temperature: float = 0.2,
    max_tokens: int = 512,
) -> Tuple[str, str, bool]:
    try:
        content = _openrouter_chat_completion(
            api_key=api_key,
            model=primary_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return content, primary_model, False
    except Exception as primary_exc:
        try:
            content = _openrouter_chat_completion(
                api_key=api_key,
                model=OPENROUTER_FREE_MODEL,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            return content, OPENROUTER_FREE_MODEL, True
        except Exception as fallback_exc:
            attempts = [
                {
                    "model": primary_model,
                    "type": "model_error",
                    "reason": str(primary_exc),
                },
                {
                    "model": OPENROUTER_FREE_MODEL,
                    "type": "model_error",
                    "reason": str(fallback_exc),
                },
            ]
            raise OpenRouterFallbackError(attempts) from fallback_exc


def _extract_task_context_text(payload: Dict[str, Any]) -> str:
    task_sources = []
    for key in ("tasks", "todos", "microsoftTasks", "taskData"):
        value = payload.get(key)
        if isinstance(value, list):
            task_sources.extend(value)

    if not task_sources:
        nested = payload.get("data")
        if isinstance(nested, dict):
            for key in ("tasks", "todos"):
                value = nested.get(key)
                if isinstance(value, list):
                    task_sources.extend(value)

    lines = []
    for item in task_sources[:25]:
        if isinstance(item, dict):
            title = str(item.get("title") or item.get("name") or "").strip()
            if not title:
                continue
            done = bool(item.get("isDone") or item.get("completed") or item.get("status") == "completed")
            due = str(item.get("dueDate") or item.get("due_date") or item.get("due") or "").strip()
            state = "done" if done else "open"
            due_part = f", due {due}" if due else ""
            lines.append(f"- {title} ({state}{due_part})")
        elif isinstance(item, str):
            title = item.strip()
            if title:
                lines.append(f"- {title}")

    if not lines:
        return ""

    return "Microsoft To-Do task context:\n" + "\n".join(lines)


class OpenRouterFallbackError(Exception):
    def __init__(self, attempts: list[Dict[str, Any]]):
        self.attempts = attempts
        super().__init__("All OpenRouter fallback models failed")


def _ai_summarize_with_openrouter(api_key: str, text: str, ratio_percent: float) -> Tuple[str, str]:
    sentences = _split_sentences(text)
    sentence_goal = max(1, min(12, round((ratio_percent / 100.0) * max(1, len(sentences)))))

    fallback_models = [
        "qwen/qwen3.6-plus:free",
        "meta-llama/llama-3.1-8b-instruct:free",
        "openrouter/free",
    ]
    attempt_failures: list[Dict[str, Any]] = []

    for current_model in fallback_models:
        payload = {
            "model": current_model,
            "temperature": 0.2,
            "messages": [
                {
                    "role": "system",
                    "content": "You are a concise summarizer. Return only the final summary text without headings.",
                },
                {
                    "role": "user",
                    "content": (
                        f"Summarize the following content in about {sentence_goal} sentences. "
                        f"Keep the most important points and keep it factual.\\n\\n{text}"
                    ),
                },
            ],
        }

        req = urlrequest.Request(
            "https://openrouter.ai/api/v1/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            method="POST",
        )

        try:
            # Keep per-model timeout short to avoid serverless execution limits.
            with urlrequest.urlopen(req, timeout=8) as response:
                parsed = json.loads(response.read().decode("utf-8"))
                choices = parsed.get("choices") or []
                if not choices:
                    attempt_failures.append(
                        {
                            "model": current_model,
                            "type": "invalid_response",
                            "reason": "No choices returned",
                        }
                    )
                    continue

                message = choices[0].get("message") or {}
                content = message.get("content")
                if isinstance(content, list):
                    parts = []
                    for item in content:
                        if isinstance(item, dict):
                            text_part = str(item.get("text") or "").strip()
                            if text_part:
                                parts.append(text_part)
                    summary = " ".join(parts).strip()
                else:
                    summary = str(content or "").strip()

                if not summary:
                    attempt_failures.append(
                        {
                            "model": current_model,
                            "type": "invalid_response",
                            "reason": "Empty summary returned",
                        }
                    )
                    continue

                return summary, current_model
        except urlerror.HTTPError as exc:
            attempt_failures.append(
                {
                    "model": current_model,
                    "type": "http_error",
                    "status": int(getattr(exc, "code", 0) or 0),
                    "reason": str(getattr(exc, "reason", "") or ""),
                }
            )
            continue
        except urlerror.URLError as exc:
            attempt_failures.append(
                {
                    "model": current_model,
                    "type": "network_error",
                    "reason": str(getattr(exc, "reason", "") or str(exc)),
                }
            )
            continue
        except TimeoutError:
            attempt_failures.append(
                {
                    "model": current_model,
                    "type": "timeout",
                    "reason": "Request timed out",
                }
            )
            continue
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            attempt_failures.append(
                {
                    "model": current_model,
                    "type": "parse_error",
                    "reason": str(exc),
                }
            )
            continue

    raise OpenRouterFallbackError(attempt_failures)


def _get_supabase_client() -> Client:
    return _ensure_supabase_client()


def _extract_bearer_token() -> str:
    auth_header = str(request.headers.get("Authorization") or "").strip()
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()
        if token:
            return token

    # Optional fallback header some clients use for proxied auth.
    return str(request.headers.get("X-Supabase-Auth") or "").strip()


def _decode_unverified_jwt_sub(token: str) -> Optional[str]:
    parts = token.split(".")
    if len(parts) < 2:
        return None

    payload_segment = parts[1]
    padding = "=" * ((4 - (len(payload_segment) % 4)) % 4)
    try:
        decoded = base64.urlsafe_b64decode((payload_segment + padding).encode("utf-8")).decode("utf-8")
        payload = json.loads(decoded)
        sub = str(payload.get("sub") or "").strip()
        return sub or None
    except Exception:
        return None


def _get_request_user_id(required: bool = True) -> Tuple[Optional[str], Optional[str]]:
    token = _extract_bearer_token()
    if not token:
        if required:
            # Backward-compatible guest mode for static pages that do not yet
            # attach Supabase JWTs. Data stays user-scoped via session cookie.
            guest_user_id = str(session.get("focusbuddy_guest_user_id") or "").strip()
            if not guest_user_id:
                guest_user_id = f"guest-{secrets.token_urlsafe(18)}"
                session["focusbuddy_guest_user_id"] = guest_user_id
            return guest_user_id, None
        return None, None

    supabase = _get_supabase_client()
    try:
        user_response = supabase.auth.get_user(token)
        user_obj = getattr(user_response, "user", None)

        if user_obj is None and isinstance(user_response, dict):
            user_obj = user_response.get("user")

        user_id = str(getattr(user_obj, "id", None) or (user_obj.get("id") if isinstance(user_obj, dict) else "") or "").strip()
        if user_id:
            return user_id, None
    except Exception:
        # Continue to non-verifying fallback extraction so serverless requests
        # can still be scoped when auth-user fetch is temporarily unavailable.
        pass

    fallback_sub = _decode_unverified_jwt_sub(token)
    if fallback_sub:
        return fallback_sub, None

    return None, "Invalid Supabase auth token"


def _serialize_todo(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row.get("id"),
        "title": row.get("title"),
        "isDone": bool(row.get("is_done")),
        "dueDate": row.get("due_date"),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
    }


def _extract_timer_minutes(raw_payload: Dict[str, Any], message_text: str) -> int:
    payload_minutes = raw_payload.get("minutes", raw_payload.get("timerMinutes"))
    if payload_minutes is not None:
        try:
            return max(1, min(240, int(payload_minutes)))
        except (TypeError, ValueError):
            pass

    minute_match = re.search(r"(\d{1,3})\s*(m|min|mins|minute|minutes)\b", message_text.lower())
    if minute_match:
        try:
            return max(1, min(240, int(minute_match.group(1))))
        except (TypeError, ValueError):
            return 25

    return 25


def _openrouter_chat_completion(
    api_key: str,
    model: str,
    messages: list[Dict[str, str]],
    temperature: float = 0.2,
    max_tokens: int = 512,
) -> str:
    payload = {
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": messages,
    }

    req = urlrequest.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    with urlrequest.urlopen(req, timeout=10) as response:
        parsed = json.loads(response.read().decode("utf-8"))
        choices = parsed.get("choices") or []
        if not choices:
            raise ValueError("OpenRouter returned no choices")

        message = choices[0].get("message") or {}
        content = message.get("content")
        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, dict):
                    text_part = str(item.get("text") or "").strip()
                    if text_part:
                        parts.append(text_part)
            final_content = " ".join(parts).strip()
        else:
            final_content = str(content or "").strip()

    if not final_content:
        raise ValueError("OpenRouter returned empty content")
    return final_content


def _route_aria_intent(message_text: str, api_key: str) -> Tuple[str, str, bool]:
    raw_intent, model_used, used_fallback = _openrouter_chat_completion_with_fallback(
        api_key=api_key,
        primary_model=INTENT_MODEL,
        temperature=0.0,
        max_tokens=12,
        messages=[
            {
                "role": "system",
                "content": (
                    "Classify user intent and return exactly one token: "
                    "[CHAT], [COACH], [SUMMARIZE], [HUMANIZE], or [TIMER]."
                ),
            },
            {"role": "user", "content": message_text},
        ],
    )
    raw_intent = raw_intent.strip().upper()

    if "SUMMARIZE" in raw_intent:
        return "[SUMMARIZE]", model_used, used_fallback
    if "HUMANIZE" in raw_intent:
        return "[HUMANIZE]", model_used, used_fallback
    if "COACH" in raw_intent:
        return "[COACH]", model_used, used_fallback
    if "TIMER" in raw_intent:
        return "[TIMER]", model_used, used_fallback
    return "[CHAT]", model_used, used_fallback


def _detect_cipher_intent(message_text: str, api_key: str) -> Dict[str, Any]:
    if api_key:
        intent, model_used, used_fallback = _route_aria_intent(message_text, api_key)
        # If model routing is uncertain, prefer deterministic keyword routing
        # for known command-style intents (timer/summarize/humanize/coach).
        rule_intent = _rule_based_intent(message_text)
        if intent == "[CHAT]" and rule_intent != "[CHAT]":
            intent = rule_intent
        return {
            "intent": intent,
            "usedFallback": used_fallback,
            "provider": "openrouter",
            "modelUsed": model_used,
        }

    return {
        "intent": _rule_based_intent(message_text),
        "usedFallback": True,
        "provider": "local",
        "modelUsed": "rule-based",
    }


def _rule_based_intent(message_text: str) -> str:
    text = message_text.lower()
    if any(keyword in text for keyword in ["summarize", "summary", "tldr", "tl;dr"]):
        return "[SUMMARIZE]"
    if any(keyword in text for keyword in ["humanize", "rewrite", "natural", "friendlier"]):
        return "[HUMANIZE]"
    if any(keyword in text for keyword in ["coach", "coaching", "mentor", "guide", "advice", "help me plan"]):
        return "[COACH]"
    if any(keyword in text for keyword in ["timer", "focus", "pomodoro", "countdown", "start for"]):
        return "[TIMER]"
    return "[CHAT]"


def _summarize_with_model(api_key: str, text: str, ratio_percent: float, model: str) -> Tuple[str, str, bool]:
    sentences = _split_sentences(text)
    sentence_goal = max(1, min(12, round((ratio_percent / 100.0) * max(1, len(sentences)))))

    summary_text, model_used, used_fallback = _openrouter_chat_completion_with_fallback(
        api_key=api_key,
        primary_model=model,
        temperature=0.2,
        max_tokens=650,
        messages=[
            {
                "role": "system",
                "content": "You are a concise summarizer. Return only the final summary text without headings.",
            },
            {
                "role": "user",
                "content": (
                    f"Summarize the following content in about {sentence_goal} sentences. "
                    f"Keep the most important points and keep it factual.\\n\\n{text}"
                ),
            },
        ],
    )
    return summary_text, model_used, used_fallback


def _fallback_sorted_tasks_for_user(user_id: Optional[str]) -> list[Dict[str, Any]]:
    if not user_id:
        return []

    supabase = _get_supabase_client()
    result = supabase.table("todos").select("*").eq("user_id", user_id).execute()
    rows = result.data or []
    todos = [_serialize_todo(row) for row in rows]

    def sort_key(item: Dict[str, Any]):
        due_date = item.get("dueDate") or "9999-12-31"
        return (bool(item.get("isDone")), due_date, str(item.get("title") or "").lower())

    return sorted(todos, key=sort_key)


def _build_graph_client() -> Tuple[Optional[msal.ConfidentialClientApplication], Optional[str], Optional[list]]:
    tenant_id = (os.getenv("AZURE_TENANT_ID", "") or os.getenv("GRAPH_TENANT_ID", "")).strip()
    client_id = (os.getenv("AZURE_CLIENT_ID", "") or os.getenv("GRAPH_CLIENT_ID", "")).strip()
    client_secret = (os.getenv("AZURE_CLIENT_SECRET", "") or os.getenv("GRAPH_CLIENT_SECRET", "")).strip()
    scopes_raw = os.getenv("GRAPH_SCOPES", "https://graph.microsoft.com/.default").strip()

    missing_vars = []
    if not tenant_id:
        missing_vars.append("AZURE_TENANT_ID")
    if not client_id:
        missing_vars.append("AZURE_CLIENT_ID")
    if not client_secret:
        missing_vars.append("AZURE_CLIENT_SECRET")

    if missing_vars:
        return None, f"Missing required Graph environment variables: {', '.join(missing_vars)}", None

    authority = f"https://login.microsoftonline.com/{tenant_id}"
    scopes = [scope.strip() for scope in scopes_raw.split(",") if scope.strip()]
    if not scopes:
        scopes = ["https://graph.microsoft.com/.default"]

    try:
        graph_client = msal.ConfidentialClientApplication(
            client_id=client_id,
            authority=authority,
            client_credential=client_secret,
        )
        return graph_client, None, scopes
    except Exception as exc:
        return None, f"Failed to initialize Graph auth client: {exc}", None


def _acquire_graph_token() -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    graph_client, init_error, scopes = _build_graph_client()
    if init_error:
        return None, init_error
    if graph_client is None or scopes is None:
        return None, "Graph auth client not configured"

    token_result = graph_client.acquire_token_for_client(scopes=scopes)
    access_token = token_result.get("access_token")
    if access_token:
        return token_result, None

    error_description = token_result.get("error_description") or token_result.get("error") or "Unknown Graph auth error"
    return None, str(error_description)


def _get_graph_delegated_scopes() -> list[str]:
    scopes_raw = os.getenv("AZURE_DELEGATED_SCOPES", "Tasks.ReadWrite")
    reserved_scopes = {"openid", "profile", "offline_access"}
    scopes = [
        scope.strip()
        for scope in scopes_raw.split(",")
        if scope.strip() and scope.strip().lower() not in reserved_scopes
    ]
    return scopes or ["Tasks.ReadWrite"]


def _get_microsoft_redirect_uri() -> str:
    configured = (os.getenv("AZURE_AUTH_REDIRECT_URI") or "").strip()
    if configured:
        return configured

    return f"{request.host_url.rstrip('/')}/api/auth/microsoft/callback"


def _build_msal_confidential_app() -> Tuple[Optional[msal.ConfidentialClientApplication], Optional[str]]:
    tenant_id = (os.getenv("AZURE_TENANT_ID", "") or os.getenv("GRAPH_TENANT_ID", "")).strip()
    client_id = (os.getenv("AZURE_CLIENT_ID", "") or os.getenv("GRAPH_CLIENT_ID", "")).strip()
    client_secret = (os.getenv("AZURE_CLIENT_SECRET", "") or os.getenv("GRAPH_CLIENT_SECRET", "")).strip()

    if not tenant_id or not client_id or not client_secret:
        return None, "Missing AZURE_TENANT_ID, AZURE_CLIENT_ID, or AZURE_CLIENT_SECRET"

    authority = f"https://login.microsoftonline.com/{tenant_id}"
    try:
        return (
            msal.ConfidentialClientApplication(
                client_id=client_id,
                authority=authority,
                client_credential=client_secret,
            ),
            None,
        )
    except Exception as exc:
        return None, f"Failed to initialize Microsoft auth client: {exc}"


def _sanitize_redirect_target(raw_target: str) -> str:
    candidate = (raw_target or "").strip()
    if not candidate:
        return "/todo.html"

    if candidate.startswith("/"):
        return candidate

    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"}:
        return "/todo.html"

    host = (parsed.hostname or "").lower()
    request_host = (request.host or "").split(":")[0].lower()
    if host not in {"localhost", "127.0.0.1", request_host}:
        return "/todo.html"

    return candidate


def _get_microsoft_auth_session_id() -> Optional[str]:
    auth_session_id = str(session.get("ms_auth_session_id") or "").strip()
    return auth_session_id or None


def _get_microsoft_auth_session_id() -> Optional[str]:
    auth_session_id = str(session.get("ms_auth_session_id") or "").strip()
    return auth_session_id or None


def _persist_microsoft_auth_session(auth_session_id: str, token_result: Dict[str, Any]) -> None:
    access_token = token_result.get("access_token")
    if not access_token:
        raise RuntimeError("Missing access token in delegated auth result")

    expires_in = int(token_result.get("expires_in") or 0)
    refresh_token = token_result.get("refresh_token")
    id_token_claims = token_result.get("id_token_claims") or {}
    expires_at = int(time.time()) + max(0, expires_in - 60)
    user_info = {
        "displayName": id_token_claims.get("name"),
        "userPrincipalName": id_token_claims.get("preferred_username") or id_token_claims.get("upn") or id_token_claims.get("email"),
        "userId": id_token_claims.get("oid") or id_token_claims.get("sub"),
    }

    session["ms_auth_session_id"] = auth_session_id
    session["ms_graph_authenticated"] = True
    session["ms_graph_user"] = user_info

    record = {
        "auth_session_id": auth_session_id,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": expires_at,
        "display_name": user_info.get("displayName"),
        "user_principal_name": user_info.get("userPrincipalName"),
        "user_id": user_info.get("userId"),
    }

    _microsoft_token_cache[auth_session_id] = {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": expires_at,
        "user": user_info,
    }

    try:
        supabase = _get_supabase_client()
        supabase.table(_MICROSOFT_SESSION_TABLE).upsert(record, on_conflict="auth_session_id").execute()
    except Exception:
        # Keep local fallback working even if persistence is unavailable.
        pass


def _save_delegated_token_result(token_result: Dict[str, Any]) -> str:
    auth_session_id = str(session.get("ms_auth_session_id") or "").strip() or secrets.token_urlsafe(32)
    _persist_microsoft_auth_session(auth_session_id, token_result)
    return auth_session_id


def _clear_microsoft_auth_session() -> None:
    auth_session_id = _get_microsoft_auth_session_id()
    if auth_session_id:
        _microsoft_token_cache.pop(auth_session_id, None)
        try:
            supabase = _get_supabase_client()
            supabase.table(_MICROSOFT_SESSION_TABLE).delete().eq("auth_session_id", auth_session_id).execute()
        except Exception:
            pass

    for key in [
        "ms_graph_authenticated",
        "ms_graph_user",
        "ms_auth_state",
        "ms_auth_next",
        "ms_auth_session_id",
    ]:
        session.pop(key, None)


def _load_persisted_microsoft_auth_session(auth_session_id: str) -> Optional[Dict[str, Any]]:
    cached = _microsoft_token_cache.get(auth_session_id)
    if cached:
        return cached

    try:
        supabase = _get_supabase_client()
        result = supabase.table(_MICROSOFT_SESSION_TABLE).select("*").eq("auth_session_id", auth_session_id).limit(1).execute()
        rows = result.data or []
        if not rows:
            return None
        row = rows[0] or {}
        loaded = {
            "access_token": row.get("access_token"),
            "refresh_token": row.get("refresh_token"),
            "expires_at": int(row.get("expires_at") or 0),
            "user": {
                "displayName": row.get("display_name"),
                "userPrincipalName": row.get("user_principal_name"),
                "userId": row.get("user_id"),
            },
        }
        _microsoft_token_cache[auth_session_id] = loaded
        return loaded
    except Exception:
        return None


def _get_delegated_graph_access_token() -> Tuple[Optional[str], Optional[str]]:
    auth_session_id = _get_microsoft_auth_session_id()
    if not auth_session_id:
        return None, "Microsoft user session is not authenticated"

    cached = _load_persisted_microsoft_auth_session(auth_session_id)
    if not cached:
        return None, "Microsoft user session expired. Sign in again."

    access_token = str(cached.get("access_token") or "").strip()
    expires_at = int(cached.get("expires_at") or 0)
    now_ts = int(time.time())

    if access_token and expires_at > now_ts:
        return access_token, None

    refresh_token = str(cached.get("refresh_token") or "").strip()
    if not refresh_token:
        _microsoft_token_cache.pop(auth_session_id, None)
        return None, "Microsoft user session expired. Sign in again."

    msal_app, msal_error = _build_msal_confidential_app()
    if msal_error:
        return None, msal_error
    if msal_app is None:
        return None, "Microsoft auth client unavailable"

    try:
        refreshed = msal_app.acquire_token_by_refresh_token(
            refresh_token,
            scopes=_get_graph_delegated_scopes(),
        )
    except Exception as exc:
        return None, f"Failed to refresh delegated token: {exc}"

    if not refreshed.get("access_token"):
        _microsoft_token_cache.pop(auth_session_id, None)
        try:
            supabase = _get_supabase_client()
            supabase.table(_MICROSOFT_SESSION_TABLE).delete().eq("auth_session_id", auth_session_id).execute()
        except Exception:
            pass
        return None, str(refreshed.get("error_description") or refreshed.get("error") or "Token refresh failed")

    _persist_microsoft_auth_session(auth_session_id, refreshed)
    return str(refreshed.get("access_token")), None


def _graph_request(
    method: str,
    url: str,
    access_token: str,
    payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    body = None
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
    }

    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload).encode("utf-8")

    req = urlrequest.Request(url, data=body, headers=headers, method=method)

    try:
        with urlrequest.urlopen(req, timeout=10) as response:
            raw_body = response.read().decode("utf-8")
            parsed_body = json.loads(raw_body) if raw_body else None
            return {"ok": True, "status": int(getattr(response, "status", 200) or 200), "data": parsed_body}
    except urlerror.HTTPError as exc:
        raw_body = exc.read().decode("utf-8") if hasattr(exc, "read") else ""
        details: Any = raw_body
        if raw_body:
            try:
                details = json.loads(raw_body)
            except (ValueError, json.JSONDecodeError):
                details = raw_body
        return {
            "ok": False,
            "status": int(getattr(exc, "code", 500) or 500),
            "error": str(getattr(exc, "reason", "") or "Microsoft Graph request failed"),
            "details": details,
        }
    except urlerror.URLError as exc:
        return {"ok": False, "status": 502, "error": str(getattr(exc, "reason", "") or str(exc))}


def _graph_todo_user_identifier() -> Tuple[Optional[str], Optional[str]]:
    user_identifier = (
        (os.getenv("AZURE_TODO_USER_PRINCIPAL_NAME", "") or os.getenv("GRAPH_TODO_USER_PRINCIPAL_NAME", ""))
        or ""
    ).strip()

    if user_identifier:
        return user_identifier, None

    return None, "Set AZURE_TODO_USER_PRINCIPAL_NAME for app-only fallback, or sign in with Microsoft for delegated mode"


def _serialize_graph_todo_list(todo_list: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": todo_list.get("id"),
        "displayName": todo_list.get("displayName"),
        "isOwner": bool(todo_list.get("isOwner")),
        "isShared": bool(todo_list.get("isShared")),
        "wellknownListName": todo_list.get("wellknownListName"),
    }


def _serialize_graph_todo_task(todo_task: Dict[str, Any], list_id: str, list_name: str) -> Dict[str, Any]:
    due_date_time = todo_task.get("dueDateTime") or {}
    raw_due_date = due_date_time.get("dateTime") or ""
    due_date = raw_due_date[:10] if isinstance(raw_due_date, str) and raw_due_date else None
    status = str(todo_task.get("status") or "notStarted")

    return {
        "id": todo_task.get("id"),
        "title": todo_task.get("title"),
        "isDone": status.lower() == "completed",
        "dueDate": due_date,
        "createdAt": todo_task.get("createdDateTime"),
        "updatedAt": todo_task.get("lastModifiedDateTime") or todo_task.get("bodyLastModifiedDateTime"),
        "source": "microsoft",
        "readOnly": True,
        "microsoftTodo": {"listId": list_id, "listName": list_name, "status": status},
    }


def _resolve_graph_todo_list_id(
    access_token: str,
    user_identifier: Optional[str] = None,
    requested_list_id: Optional[str] = None,
    use_me_endpoint: bool = False,
) -> Tuple[Optional[Dict[str, Any]], Optional[list], Optional[str]]:
    if use_me_endpoint:
        lists_url = "https://graph.microsoft.com/v1.0/me/todo/lists"
    else:
        if not user_identifier:
            return None, None, "Missing Microsoft To Do user identifier"
        lists_url = f"https://graph.microsoft.com/v1.0/users/{quote(user_identifier, safe='')}/todo/lists"

    lists_response = _graph_request(
        "GET",
        lists_url,
        access_token,
    )
    if not lists_response["ok"]:
        return None, None, f"Failed to load Microsoft To Do lists: {lists_response.get('error')}"

    raw_lists = (lists_response.get("data") or {}).get("value") or []
    lists = [item for item in raw_lists if isinstance(item, dict)]
    if not lists:
        return None, [], None

    selected_list = None
    if requested_list_id:
        selected_list = next((item for item in lists if str(item.get("id")) == str(requested_list_id)), None)

    if selected_list is None:
        selected_list = next(
            (item for item in lists if str(item.get("wellknownListName") or "").lower() == "defaultlist"),
            None,
        ) or lists[0]

    return selected_list, lists, None


def _load_graph_todo_view(
    access_token: str,
    requested_list_id: Optional[str],
    user_identifier: Optional[str] = None,
    use_me_endpoint: bool = False,
    source: str = "microsoft",
    read_only: bool = True,
) -> Tuple[Optional[Dict[str, Any]], Optional[int], Optional[Dict[str, Any]]]:
    selected_list, lists, list_error = _resolve_graph_todo_list_id(
        access_token,
        user_identifier,
        requested_list_id,
        use_me_endpoint=use_me_endpoint,
    )
    if list_error:
        return None, 500, {"reason": list_error}

    if not selected_list:
        return {
            "provider": source,
            "readOnly": read_only,
            "userPrincipalName": user_identifier,
            "lists": [],
            "selectedList": None,
            "todos": [],
        }, None, None

    if use_me_endpoint:
        tasks_url = f"https://graph.microsoft.com/v1.0/me/todo/lists/{quote(str(selected_list.get('id') or ''), safe='')}/tasks"
    else:
        tasks_url = f"https://graph.microsoft.com/v1.0/users/{quote(str(user_identifier or ''), safe='')}/todo/lists/{quote(str(selected_list.get('id') or ''), safe='')}/tasks"

    tasks_response = _graph_request(
        "GET",
        tasks_url,
        access_token,
    )
    if not tasks_response["ok"]:
        return None, 500, {"reason": f"Failed to load Microsoft To Do tasks: {tasks_response.get('error')}"}

    raw_tasks = (tasks_response.get("data") or {}).get("value") or []
    tasks = [
        _serialize_graph_todo_task(task, str(selected_list.get("id") or ""), str(selected_list.get("displayName") or ""))
        for task in raw_tasks
        if isinstance(task, dict)
    ]

    return {
        "provider": source,
        "readOnly": read_only,
        "userPrincipalName": user_identifier,
        "lists": [_serialize_graph_todo_list(item) for item in lists],
        "selectedList": _serialize_graph_todo_list(selected_list),
        "todos": tasks,
    }, None, None


def _normalize_task_key(raw_value: Any) -> str:
    normalized = re.sub(r"\s+", " ", str(raw_value or "").strip().lower())
    return normalized


def _extract_estimated_minutes_from_task(task: Dict[str, Any]) -> int:
    for field in [
        "estimatedMinutes",
        "estimateMinutes",
        "estimated_minutes",
        "estimated_time_minutes",
        "estimatedDurationMinutes",
    ]:
        value = task.get(field)
        if value is None:
            continue
        try:
            parsed = int(float(value))
            if parsed > 0:
                return parsed
        except (TypeError, ValueError):
            continue

    title = str(task.get("title") or "")
    hour_match = re.search(r"(estimate|est|eta)\s*[:=-]?\s*(\d+(?:\.\d+)?)\s*h\b", title, re.IGNORECASE)
    if hour_match:
        return max(1, round(float(hour_match.group(2)) * 60))

    minute_match = re.search(r"(estimate|est|eta)\s*[:=-]?\s*(\d{1,4})\s*m(?:in(?:ute)?s?)?\b", title, re.IGNORECASE)
    if minute_match:
        return max(1, int(minute_match.group(2)))

    return 60


def _extract_completed_datetime(task: Dict[str, Any]) -> Optional[str]:
    completed = task.get("completedDateTime")
    if isinstance(completed, dict):
        completed_value = str(completed.get("dateTime") or "").strip()
        if completed_value:
            return completed_value

    fallback = str(task.get("completedDateTime") or "").strip()
    return fallback or None


def _extract_focus_minutes_from_row(row: Dict[str, Any]) -> float:
    ms_candidates = ["focus_ms", "session_ms", "duration_ms", "durationMs"]
    for field in ms_candidates:
        value = row.get(field)
        if value is None:
            continue
        try:
            parsed_ms = float(value)
            if parsed_ms > 0:
                return parsed_ms / 60000.0
        except (TypeError, ValueError):
            continue

    minute_candidates = ["duration_minutes", "durationMinutes", "focus_minutes", "minutes", "duration"]
    for field in minute_candidates:
        value = row.get(field)
        if value is None:
            continue
        try:
            parsed_minutes = float(value)
            if parsed_minutes > 0:
                return parsed_minutes
        except (TypeError, ValueError):
            continue

    return 0.0


def _extract_focus_task_keys(row: Dict[str, Any]) -> list[str]:
    keys: list[str] = []
    for field in [
        "task_id",
        "taskId",
        "todo_id",
        "todoId",
        "microsoft_task_id",
        "microsoftTaskId",
        "task_title",
        "taskTitle",
        "title",
        "task_name",
        "taskName",
        "name",
    ]:
        normalized = _normalize_task_key(row.get(field))
        if normalized:
            keys.append(normalized)

    deduped = []
    seen = set()
    for key in keys:
        if key in seen:
            continue
        seen.add(key)
        deduped.append(key)
    return deduped


def _fetch_completed_graph_tasks_for_velocity() -> Tuple[list[Dict[str, Any]], Optional[str]]:
    delegated_token, delegated_error = _get_delegated_graph_access_token()
    access_token: Optional[str] = None
    user_identifier: Optional[str] = None
    use_me_endpoint = False

    if delegated_token and not delegated_error:
        access_token = delegated_token
        use_me_endpoint = True
    else:
        token_result, auth_error = _acquire_graph_token()
        if auth_error:
            return [], f"Microsoft Graph authentication failed: {auth_error}"

        access_token = str(token_result.get("access_token") or "").strip()
        user_identifier, user_error = _graph_todo_user_identifier()
        if user_error:
            return [], f"Graph app-only mode requires a configured user: {user_error}"

    selected_list, lists, list_error = _resolve_graph_todo_list_id(
        access_token=access_token,
        user_identifier=user_identifier,
        requested_list_id=None,
        use_me_endpoint=use_me_endpoint,
    )
    if list_error:
        return [], list_error

    if not lists:
        return [], None

    completed_tasks: list[Dict[str, Any]] = []
    for todo_list in lists:
        list_id = str(todo_list.get("id") or "").strip()
        if not list_id:
            continue

        if use_me_endpoint:
            tasks_url = f"https://graph.microsoft.com/v1.0/me/todo/lists/{quote(list_id, safe='')}/tasks"
        else:
            tasks_url = (
                "https://graph.microsoft.com/v1.0/users/"
                f"{quote(str(user_identifier or ''), safe='')}/todo/lists/{quote(list_id, safe='')}/tasks"
            )

        tasks_response = _graph_request("GET", tasks_url, access_token)
        if not tasks_response.get("ok"):
            return [], f"Failed to fetch Graph tasks for list {list_id}: {tasks_response.get('error')}"

        for task in (tasks_response.get("data") or {}).get("value") or []:
            if not isinstance(task, dict):
                continue

            status = str(task.get("status") or "").strip().lower()
            if status != "completed":
                continue

            completed_tasks.append(
                {
                    "id": task.get("id"),
                    "title": task.get("title"),
                    "createdDateTime": task.get("createdDateTime"),
                    "completedDateTime": _extract_completed_datetime(task),
                    "estimatedMinutes": _extract_estimated_minutes_from_task(task),
                }
            )

    completed_tasks.sort(key=lambda item: str(item.get("completedDateTime") or ""), reverse=True)
    return completed_tasks, None


def _fetch_focus_minutes_index_for_velocity(user_id: str) -> Tuple[Dict[str, float], float, Optional[str]]:
    supabase = _get_supabase_client()
    try:
        result = supabase.table("focus_sessions").select("*").eq("user_id", user_id).limit(1000).execute()
    except Exception as exc:
        return {}, 0.0, f"Failed to load focus sessions: {exc}"

    rows = result.data or []
    total_focus_minutes = 0.0
    focus_by_task_key: Dict[str, float] = {}

    for row in rows:
        if not isinstance(row, dict):
            continue

        duration_minutes = _extract_focus_minutes_from_row(row)
        if duration_minutes <= 0:
            continue

        total_focus_minutes += duration_minutes
        row_task_keys = _extract_focus_task_keys(row)
        for key in row_task_keys:
            focus_by_task_key[key] = focus_by_task_key.get(key, 0.0) + duration_minutes

    return focus_by_task_key, total_focus_minutes, None


def _build_velocity_efficiency_list(completed_tasks: list[Dict[str, Any]], focus_by_task_key: Dict[str, float]) -> list[Dict[str, Any]]:
    efficiency_list: list[Dict[str, Any]] = []

    for task in completed_tasks:
        task_id_key = _normalize_task_key(task.get("id"))
        task_title_key = _normalize_task_key(task.get("title"))

        actual_minutes = 0.0
        if task_id_key:
            actual_minutes = focus_by_task_key.get(task_id_key, 0.0)
        if actual_minutes <= 0 and task_title_key:
            actual_minutes = focus_by_task_key.get(task_title_key, 0.0)

        estimated_minutes = max(1, int(task.get("estimatedMinutes") or 60))
        efficiency_ratio = round(actual_minutes / estimated_minutes, 3)

        efficiency_list.append(
            {
                "task_id": task.get("id"),
                "title": task.get("title"),
                "createdDateTime": task.get("createdDateTime"),
                "completedDateTime": task.get("completedDateTime"),
                "estimated_minutes": estimated_minutes,
                "actual_minutes": round(actual_minutes, 2),
                "efficiency_ratio": efficiency_ratio,
            }
        )

    return efficiency_list


def _generate_cipher_velocity_critique(api_key: str, velocity_payload: Dict[str, Any]) -> str:
    if not api_key:
        return "Cipher critique unavailable: OPENROUTER_API_KEY is not configured."

    try:
        critique = _openrouter_chat_completion(
            api_key=api_key,
            model="qwen/qwen3.6-plus:free",
            temperature=0.2,
            max_tokens=200,
            messages=[
                {
                    "role": "system",
                    "content": "You are Cipher. Analyze this velocity data. If the user is slow, be brutally honest. If they are efficient, give a 1-sentence technical nod.",
                },
                {
                    "role": "user",
                    "content": json.dumps(velocity_payload),
                },
            ],
        )
        return critique
    except Exception as exc:
        return f"Cipher critique unavailable: {exc}"


@app.after_request
def _add_cors_headers(response):
    request_origin = (request.headers.get("Origin") or "").strip()
    allowed_origins_raw = os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:5500,http://127.0.0.1:5500")
    allowed_origins = {item.strip() for item in allowed_origins_raw.split(",") if item.strip()}

    if request_origin and (not allowed_origins or request_origin in allowed_origins):
        response.headers["Access-Control-Allow-Origin"] = request_origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Vary"] = "Origin"
    else:
        response.headers["Access-Control-Allow-Origin"] = "*"

    response.headers["Access-Control-Allow-Methods"] = "GET,POST,PATCH,DELETE,OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type,Authorization,X-Requested-With"
    return response


@app.route("/api/<path:_path>", methods=["OPTIONS"])
def options_handler(_path: str):
    return "", 204


@app.route("/api/auth/microsoft/login", methods=["GET"])
def microsoft_login():
    msal_app, msal_error = _build_msal_confidential_app()
    if msal_error:
        return _json_error("Microsoft authentication is not configured", 500, {"reason": msal_error})
    if msal_app is None:
        return _json_error("Microsoft authentication is unavailable", 500)

    state = secrets.token_urlsafe(24)
    next_target = _sanitize_redirect_target(request.args.get("next") or "")
    session["ms_auth_state"] = state
    session["ms_auth_next"] = next_target

    auth_url = msal_app.get_authorization_request_url(
        scopes=_get_graph_delegated_scopes(),
        state=state,
        redirect_uri=_get_microsoft_redirect_uri(),
        prompt="select_account",
    )
    return redirect(auth_url)


@app.route("/api/auth/microsoft/callback", methods=["GET"])
def microsoft_login_callback():
    callback_error = (request.args.get("error") or "").strip()
    if callback_error:
        return _json_error(
            "Microsoft login was denied or failed",
            400,
            {
                "error": callback_error,
                "description": request.args.get("error_description"),
            },
        )

    expected_state = session.get("ms_auth_state")
    received_state = request.args.get("state")
    if not expected_state or not received_state or str(expected_state) != str(received_state):
        return _json_error("Invalid Microsoft auth state", 400)

    auth_code = (request.args.get("code") or "").strip()
    if not auth_code:
        return _json_error("Missing authorization code", 400)

    msal_app, msal_error = _build_msal_confidential_app()
    if msal_error:
        return _json_error("Microsoft authentication is not configured", 500, {"reason": msal_error})
    if msal_app is None:
        return _json_error("Microsoft authentication is unavailable", 500)

    try:
        token_result = msal_app.acquire_token_by_authorization_code(
            auth_code,
            scopes=_get_graph_delegated_scopes(),
            redirect_uri=_get_microsoft_redirect_uri(),
        )
    except Exception as exc:
        return _json_error("Failed to complete Microsoft login", 500, {"reason": str(exc)})

    if not token_result.get("access_token"):
        return _json_error(
            "Failed to acquire delegated Graph token",
            500,
            {
                "reason": token_result.get("error_description") or token_result.get("error") or "Unknown error",
            },
        )

    _save_delegated_token_result(token_result)
    session.pop("ms_auth_state", None)
    redirect_target = _sanitize_redirect_target(session.pop("ms_auth_next", "/todo.html"))
    return redirect(redirect_target)


@app.route("/api/auth/microsoft/logout", methods=["POST", "GET"])
def microsoft_logout():
    _clear_microsoft_auth_session()
    if request.method == "GET":
        redirect_target = _sanitize_redirect_target(request.args.get("next") or "/todo.html")
        return redirect(redirect_target)
    return jsonify({"ok": True})


@app.route("/api/auth/microsoft/status", methods=["GET"])
def microsoft_auth_status():
    if not session.get("ms_graph_authenticated"):
        return jsonify(
            {
                "authenticated": False,
                "user": None,
            }
        )

    access_token, token_error = _get_delegated_graph_access_token()
    if token_error:
        _clear_microsoft_auth_session()
        return jsonify(
            {
                "authenticated": False,
                "user": None,
                "reason": token_error,
            }
        )

    user_info = session.get("ms_graph_user") or {}
    return jsonify(
        {
            "authenticated": bool(access_token),
            "user": {
                "displayName": user_info.get("displayName"),
                "userPrincipalName": user_info.get("userPrincipalName"),
                "userId": user_info.get("userId"),
            },
            "supportsWrite": True,
        }
    )


@app.route("/api/ai-config", methods=["GET"])
def ai_config():
    api_key = _get_ai_api_key()
    provider = _infer_ai_provider(api_key) if api_key else None
    return jsonify({"hasApiKey": bool(api_key), "provider": provider})


@app.route("/api/graph-auth", methods=["GET"])
def graph_auth_status():
    token_result, error_message = _acquire_graph_token()
    if error_message:
        return _json_error("Microsoft Graph authentication failed", 500, {"reason": error_message})

    return jsonify(
        {
            "authenticated": True,
            "tokenType": token_result.get("token_type"),
            "expiresIn": token_result.get("expires_in"),
        }
    )


@app.route("/api/microsoft-todo/status", methods=["GET"])
def microsoft_todo_status():
    delegated_token, delegated_error = _get_delegated_graph_access_token()
    if delegated_token and not delegated_error:
        user_info = session.get("ms_graph_user") or {}
        return jsonify(
            {
                "configured": True,
                "authenticated": True,
                "readOnly": False,
                "supportsWrite": True,
                "mode": "delegated",
                "userConfigured": True,
                "requiresUserPrincipalName": False,
                "userPrincipalName": user_info.get("userPrincipalName"),
                "user": user_info,
            }
        )

    token_result, error_message = _acquire_graph_token()
    if error_message:
        return jsonify(
            {
                "configured": False,
                "authenticated": False,
                "readOnly": True,
                "supportsWrite": False,
                "reason": error_message,
            }
        )

    user_identifier, user_error = _graph_todo_user_identifier()
    return jsonify(
        {
            "configured": True,
            "authenticated": False,
            "readOnly": True,
            "supportsWrite": False,
            "mode": "application",
            "userConfigured": user_error is None,
            "requiresUserPrincipalName": user_error is not None,
            "userPrincipalName": user_identifier,
            "tokenType": token_result.get("token_type"),
            "expiresIn": token_result.get("expires_in"),
            "writeSupportNote": "Microsoft Graph application permissions can read To Do data, but create/update/delete operations require delegated user auth for these endpoints.",
        }
    )


@app.route("/api/microsoft-todo/lists", methods=["GET"])
def microsoft_todo_lists():
    delegated_token, delegated_error = _get_delegated_graph_access_token()
    mode = "application"
    user_identifier: Optional[str] = None
    use_me_endpoint = False
    access_token: Optional[str] = None

    if delegated_token and not delegated_error:
        mode = "delegated"
        use_me_endpoint = True
        access_token = delegated_token
        user_identifier = (session.get("ms_graph_user") or {}).get("userPrincipalName")
    else:
        token_result, error_message = _acquire_graph_token()
        if error_message:
            return _json_error("Microsoft Graph authentication failed", 500, {"reason": error_message})

        access_token = str(token_result.get("access_token") or "")
        user_identifier, user_error = _graph_todo_user_identifier()
        if user_error:
            return _json_error("Microsoft To Do user not configured", 400, {"reason": user_error})

    if use_me_endpoint:
        lists_url = "https://graph.microsoft.com/v1.0/me/todo/lists"
    else:
        lists_url = f"https://graph.microsoft.com/v1.0/users/{quote(user_identifier or '', safe='')}/todo/lists"

    lists_response = _graph_request("GET", lists_url, access_token)
    if not lists_response["ok"]:
        return _json_error(
            "Failed to load Microsoft To Do lists",
            int(lists_response.get("status") or 500),
            {"reason": lists_response.get("error"), "details": lists_response.get("details")},
        )

    raw_lists = (lists_response.get("data") or {}).get("value") or []
    lists = [_serialize_graph_todo_list(item) for item in raw_lists if isinstance(item, dict)]
    return jsonify(
        {
            "provider": "microsoft",
            "mode": mode,
            "readOnly": mode != "delegated",
            "userPrincipalName": user_identifier,
            "lists": lists,
        }
    )


@app.route("/api/microsoft-todo/tasks", methods=["GET", "POST"])
def microsoft_todo_tasks_collection():
    delegated_token, delegated_error = _get_delegated_graph_access_token()
    delegated_active = bool(delegated_token and not delegated_error)

    if request.method == "GET":
        requested_list_id = (request.args.get("listId") or "").strip() or None

        if delegated_active:
            user_info = session.get("ms_graph_user") or {}
            payload, status_code, error_details = _load_graph_todo_view(
                access_token=delegated_token,
                requested_list_id=requested_list_id,
                user_identifier=user_info.get("userPrincipalName"),
                use_me_endpoint=True,
                source="microsoft",
                read_only=False,
            )
        else:
            token_result, error_message = _acquire_graph_token()
            if error_message:
                return _json_error("Failed to load Microsoft To Do tasks", 500, {"reason": error_message})

            user_identifier, user_error = _graph_todo_user_identifier()
            if user_error:
                return _json_error("Failed to load Microsoft To Do tasks", 400, {"reason": user_error})

            payload, status_code, error_details = _load_graph_todo_view(
                access_token=str(token_result.get("access_token") or ""),
                requested_list_id=requested_list_id,
                user_identifier=user_identifier,
                use_me_endpoint=False,
                source="microsoft",
                read_only=True,
            )

        if error_details is not None:
            return _json_error("Failed to load Microsoft To Do tasks", status_code or 500, error_details)
        return jsonify(payload)

    if not delegated_active:
        return _json_error(
            "Microsoft To Do write operations require Microsoft user login",
            401,
            {
                "reason": "Authenticate via /api/auth/microsoft/login and retry.",
            },
        )

    payload = _read_json()
    title = str(payload.get("title") or "").strip()
    if not title:
        return _json_error("Title is required", 400)

    requested_list_id = str(payload.get("listId") or request.args.get("listId") or "").strip() or None
    selected_list, _lists, list_error = _resolve_graph_todo_list_id(
        delegated_token,
        requested_list_id=requested_list_id,
        use_me_endpoint=True,
    )
    if list_error:
        return _json_error("Failed to resolve Microsoft To Do list", 500, {"reason": list_error})
    if not selected_list:
        return _json_error("No Microsoft To Do list found for this account", 404)

    body: Dict[str, Any] = {"title": title}
    raw_due_date = payload.get("dueDate")
    due_date = str(raw_due_date).strip() if raw_due_date is not None else ""
    if due_date:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", due_date):
            return _json_error("dueDate must be in YYYY-MM-DD format", 400)
        body["dueDateTime"] = {"dateTime": f"{due_date}T00:00:00", "timeZone": "UTC"}

    created_response = _graph_request(
        "POST",
        f"https://graph.microsoft.com/v1.0/me/todo/lists/{quote(str(selected_list.get('id') or ''), safe='')}/tasks",
        delegated_token,
        payload=body,
    )
    if not created_response["ok"]:
        return _json_error(
            "Failed to create Microsoft To Do task",
            int(created_response.get("status") or 500),
            {"reason": created_response.get("error"), "details": created_response.get("details")},
        )

    created_task = created_response.get("data") or {}
    return jsonify({"todo": _serialize_graph_todo_task(created_task, str(selected_list.get("id") or ""), str(selected_list.get("displayName") or ""))}), 201

    return _json_error(
        "Microsoft To Do write operations are not supported with application credentials",
        501,
        {
            "reason": "To create tasks, switch to delegated Microsoft sign-in or use the local Supabase todo API.",
        },
    )


@app.route("/api/microsoft-todo/tasks/<task_id>", methods=["PATCH", "DELETE"])
def microsoft_todo_task_item(task_id: str):
    delegated_token, delegated_error = _get_delegated_graph_access_token()
    if delegated_error or not delegated_token:
        return _json_error(
            "Microsoft To Do write operations require Microsoft user login",
            401,
            {
                "taskId": task_id,
                "reason": "Authenticate via /api/auth/microsoft/login and retry.",
            },
        )

    request_payload = _read_json()
    list_id = str(request_payload.get("listId") or request.args.get("listId") or "").strip() or None
    if not list_id:
        return _json_error("listId is required", 400)

    task_url = f"https://graph.microsoft.com/v1.0/me/todo/lists/{quote(list_id, safe='')}/tasks/{quote(task_id, safe='')}"

    if request.method == "DELETE":
        delete_response = _graph_request("DELETE", task_url, delegated_token)
        if not delete_response["ok"]:
            return _json_error(
                "Failed to delete Microsoft To Do task",
                int(delete_response.get("status") or 500),
                {"reason": delete_response.get("error"), "details": delete_response.get("details")},
            )
        return jsonify({"ok": True})

    update_body: Dict[str, Any] = {}
    if "title" in request_payload:
        candidate_title = str(request_payload.get("title") or "").strip()
        if not candidate_title:
            return _json_error("Title cannot be empty", 400)
        update_body["title"] = candidate_title

    if "isDone" in request_payload:
        update_body["status"] = "completed" if bool(request_payload.get("isDone")) else "notStarted"

    if "dueDate" in request_payload:
        candidate_due = request_payload.get("dueDate")
        if candidate_due is None or str(candidate_due).strip() == "":
            update_body["dueDateTime"] = None
        else:
            due_value = str(candidate_due).strip()
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", due_value):
                return _json_error("dueDate must be in YYYY-MM-DD format", 400)
            update_body["dueDateTime"] = {"dateTime": f"{due_value}T00:00:00", "timeZone": "UTC"}

    if not update_body:
        return _json_error("Nothing to update", 400)

    update_response = _graph_request("PATCH", task_url, delegated_token, payload=update_body)
    if not update_response["ok"]:
        return _json_error(
            "Failed to update Microsoft To Do task",
            int(update_response.get("status") or 500),
            {"reason": update_response.get("error"), "details": update_response.get("details")},
        )

    task_response = _graph_request("GET", task_url, delegated_token)
    if not task_response["ok"]:
        return jsonify({"ok": True, "updated": True})

    refreshed_task = task_response.get("data") or {}
    return jsonify(
        {
            "todo": _serialize_graph_todo_task(
                refreshed_task,
                list_id,
                str(request_payload.get("listName") or ""),
            )
        }
    )


@app.route("/api/ai-summarize", methods=["POST"])
def ai_summarize():
    payload = _read_json()
    source_text = str(payload.get("text") or "").strip()
    ratio_percent = payload.get("ratioPercent", 25)

    try:
        ratio_percent = float(ratio_percent)
    except (TypeError, ValueError):
        ratio_percent = 25.0

    ratio_percent = max(10.0, min(50.0, ratio_percent))

    if not source_text:
        return _json_error("Text is required", 400)

    local_summary = _fallback_extract_summary(source_text, ratio_percent)
    api_key = _get_ai_api_key()

    if not api_key:
        return jsonify(
            _build_local_summary_response(
                local_summary,
                "No AI API key configured. Returned local summary.",
                {"type": "missing_api_key"},
            )
        )

    try:
        provider = _infer_ai_provider(api_key)
        ai_summary, model_used = _ai_summarize_with_openrouter(api_key, source_text, ratio_percent)

        return jsonify(
            {
                "summary": ai_summary,
                "sourceSentences": local_summary["sourceSentences"],
                "summarySentences": len(_split_sentences(ai_summary)),
                "sourceWords": local_summary["sourceWords"],
                "usedFallback": False,
                "provider": provider,
                "modelUsed": model_used,
            }
        )
    except OpenRouterFallbackError as exc:
        return jsonify(
            _build_local_summary_response(
                local_summary,
                "All OpenRouter fallback models failed. Returned local summary.",
                {
                    "type": "model_fallback_failed",
                    "reason": str(exc),
                    "provider": _infer_ai_provider(api_key),
                    "attempts": exc.attempts,
                },
            )
        )
    except urlerror.HTTPError as exc:
        return jsonify(
            _build_local_summary_response(
                local_summary,
                "AI provider rejected the request. Returned local summary.",
                {
                    "type": "http_error",
                    "status": int(getattr(exc, "code", 0) or 0),
                    "reason": str(getattr(exc, "reason", "") or ""),
                    "provider": _infer_ai_provider(api_key),
                },
            )
        )
    except urlerror.URLError as exc:
        return jsonify(
            _build_local_summary_response(
                local_summary,
                "AI provider unavailable. Returned local summary.",
                {
                    "type": "network_error",
                    "reason": str(getattr(exc, "reason", "") or str(exc)),
                    "provider": _infer_ai_provider(api_key),
                },
            )
        )
    except (ValueError, KeyError, json.JSONDecodeError) as exc:
        return jsonify(
            _build_local_summary_response(
                local_summary,
                "AI provider response was invalid. Returned local summary.",
                {
                    "type": "parse_error",
                    "reason": str(exc),
                    "provider": _infer_ai_provider(api_key),
                },
            )
        )


@app.route("/api/cipher", methods=["POST"])
def cipher_command_center():
    payload = _read_json()
    message_text = str(payload.get("message") or payload.get("text") or "").strip()
    if not message_text:
        return _json_error("message is required", 400)

    api_key = _get_ai_api_key()
    user_id, _user_error = _get_request_user_id(required=False)
    task_context = _extract_task_context_text(payload)
    message_with_context = message_text
    if task_context:
        message_with_context = f"{message_text}\n\n{task_context}"

    try:
        try:
            intent_result = _detect_cipher_intent(message_text, api_key)
        except Exception as intent_exc:
            intent_result = {
                "intent": _rule_based_intent(message_text),
                "provider": "local",
                "modelUsed": "rule-based",
                "usedFallback": True,
                "intentError": str(intent_exc),
            }

        intent = str(intent_result.get("intent") or "[CHAT]")
        intent_meta = {
            "intentProvider": intent_result.get("provider"),
            "intentModelUsed": intent_result.get("modelUsed"),
            "intentUsedFallback": bool(intent_result.get("usedFallback")),
        }
        if intent_result.get("intentError"):
            intent_meta["intentError"] = intent_result.get("intentError")

        if intent == "[SUMMARIZE]":
            ratio_percent = payload.get("ratioPercent", 25)
            try:
                ratio_percent = float(ratio_percent)
            except (TypeError, ValueError):
                ratio_percent = 25.0
            ratio_percent = max(10.0, min(50.0, ratio_percent))

            source_text = str(payload.get("text") or payload.get("sourceText") or "").strip()
            if not source_text:
                source_text = task_context or message_text
            local_summary = _fallback_extract_summary(source_text, ratio_percent)

            if not api_key:
                return jsonify(
                    {
                        "intent": intent,
                        **intent_meta,
                        "reply": local_summary["summary"],
                        "usedFallback": True,
                        "provider": "local",
                        "warning": "OPENROUTER_API_KEY not configured",
                    }
                )

            try:
                ai_summary, summarize_model_used, summarize_fallback_used = _summarize_with_model(
                    api_key,
                    source_text,
                    ratio_percent,
                    SUMMARIZE_MODEL,
                )
                return jsonify(
                    {
                        "intent": intent,
                        **intent_meta,
                        "reply": ai_summary,
                        "usedFallback": False,
                        "provider": "openrouter",
                        "modelUsed": summarize_model_used,
                        "modelFallbackUsed": summarize_fallback_used,
                    }
                )
            except Exception as summarize_exc:
                return jsonify(
                    {
                        "intent": intent,
                        **intent_meta,
                        "reply": local_summary["summary"],
                        "usedFallback": True,
                        "provider": "local",
                        "warning": "Qwen summarize failed. Returned local summary.",
                        "aiError": {
                            "type": "model_error",
                            "model": SUMMARIZE_MODEL,
                            "reason": str(summarize_exc),
                        },
                    }
                )

        if intent == "[HUMANIZE]":
            source_text = str(payload.get("text") or message_text).strip()
            if not api_key:
                return jsonify(
                    {
                        "intent": intent,
                        **intent_meta,
                        "reply": source_text,
                        "usedFallback": True,
                        "provider": "local",
                        "warning": "OPENROUTER_API_KEY not configured",
                    }
                )

            humanized, humanize_model_used, humanize_fallback = _openrouter_chat_completion_with_fallback(
                api_key=api_key,
                primary_model=HUMANIZE_MODEL,
                temperature=0.65,
                max_tokens=700,
                messages=[
                    {
                        "role": "system",
                        "content": "Rewrite text to sound natural and human while preserving meaning. Return only the rewritten text.",
                    },
                    {"role": "user", "content": source_text},
                ],
            )
            return jsonify(
                {
                    "intent": intent,
                    **intent_meta,
                    "reply": humanized,
                    "usedFallback": False,
                    "provider": "openrouter",
                    "modelUsed": humanize_model_used,
                    "modelFallbackUsed": humanize_fallback,
                }
            )

        if intent == "[TIMER]":
            minutes = _extract_timer_minutes(payload, message_text)
            return jsonify(
                {
                    "intent": intent,
                    **intent_meta,
                    "reply": f"Starting a {minutes}-minute focus sprint.",
                    "command": {
                        "action": "START_TIMER",
                        "duration": minutes,
                    },
                }
            )

        if not api_key:
            return jsonify(
                {
                    "intent": intent,
                    **intent_meta,
                    "reply": "Cipher is running in local mode. Set OPENROUTER_API_KEY for full intelligence.",
                    "usedFallback": True,
                    "provider": "local",
                }
            )

        try:
            chat_reply, chat_model_used, chat_fallback_used = _openrouter_chat_completion_with_fallback(
                api_key=api_key,
                primary_model=CHAT_MODEL,
                temperature=0.45,
                max_tokens=700,
                messages=[
                    {
                        "role": "system",
                        "content": CIPHER_PERSONA_PROMPT,
                    },
                    {"role": "user", "content": message_with_context},
                ],
            )
            return jsonify(
                {
                    "intent": intent,
                    **intent_meta,
                    "reply": chat_reply,
                    "usedFallback": False,
                    "provider": "openrouter",
                    "modelUsed": chat_model_used,
                    "modelFallbackUsed": chat_fallback_used,
                }
            )
        except Exception as chat_exc:
            return jsonify(
                {
                    "intent": intent,
                    **intent_meta,
                    "reply": "Cipher AI is temporarily unavailable. Use timer/summarize/humanize commands, or retry in a few seconds.",
                    "usedFallback": True,
                    "provider": "local",
                    "fallbackReason": str(chat_exc),
                }
            )
    except Exception as exc:
        fallback_sorted_tasks = []
        fallback_error = None
        try:
            fallback_sorted_tasks = _fallback_sorted_tasks_for_user(user_id)
        except Exception as sort_exc:
            fallback_error = str(sort_exc)

        return jsonify(
            {
                "intent": "[CHAT]",
                "intentProvider": "local",
                "intentModelUsed": "rule-based",
                "intentUsedFallback": True,
                "usedFallback": True,
                "provider": "local",
                "reply": "Cipher AI is temporarily unavailable. Returning locally sorted tasks.",
                "tasks": fallback_sorted_tasks,
                "fallbackReason": str(exc),
                "fallbackError": fallback_error,
            }
        )


@app.route("/api/cipher/intent", methods=["POST"])
def cipher_intent():
    payload = _read_json()
    message_text = str(payload.get("message") or payload.get("text") or "").strip()
    if not message_text:
        return _json_error("message is required", 400)

    api_key = _get_ai_api_key()

    try:
        result = _detect_cipher_intent(message_text, api_key)
        return jsonify(
            {
                "intent": result["intent"],
                "usedFallback": result["usedFallback"],
                "provider": result["provider"],
                "modelUsed": result["modelUsed"],
            }
        )
    except Exception as exc:
        return jsonify(
            {
                "intent": _rule_based_intent(message_text),
                "usedFallback": True,
                "provider": "local",
                "modelUsed": "rule-based",
                "fallbackReason": str(exc),
            }
        )


@app.route("/api/focus-sessions", methods=["POST"])
def create_focus_session():
    supabase = _get_supabase_client()
    user_id, user_error = _get_request_user_id()
    if user_error:
        return _json_error("Unauthorized", 401, {"reason": user_error})

    payload = _read_json()
    required = ["startedAt", "endedAt", "sessionMs", "focusMs", "focusRate", "distractionCount"]
    missing = [field for field in required if field not in payload]
    if missing:
        return _json_error(f"Missing required fields: {', '.join(missing)}", 400)

    try:
        session_ms = int(payload["sessionMs"])
        focus_ms = int(payload["focusMs"])
        focus_rate = float(payload["focusRate"])
        distraction_count = int(payload["distractionCount"])
    except (TypeError, ValueError):
        return _json_error("Invalid numeric values in payload", 400)

    if session_ms < 0 or focus_ms < 0 or distraction_count < 0:
        return _json_error("Metrics cannot be negative", 400)

    if focus_ms > session_ms:
        focus_ms = session_ms

    focus_rate = max(0.0, min(focus_rate, 100.0))
    created_at = _utc_now_iso()
    client_session_id = payload.get("clientSessionId")

    row = {
        "user_id": user_id,
        "client_session_id": client_session_id,
        "started_at": payload["startedAt"],
        "ended_at": payload["endedAt"],
        "session_ms": session_ms,
        "focus_ms": focus_ms,
        "focus_rate": focus_rate,
        "distraction_count": distraction_count,
        "created_at": created_at,
    }

    try:
        session_id = None
        if client_session_id:
            existing = (
                supabase.table("focus_sessions")
                .select("id")
                .eq("user_id", user_id)
                .eq("client_session_id", client_session_id)
                .limit(1)
                .execute()
            )
            existing_rows = existing.data or []
            if existing_rows:
                session_id = existing_rows[0].get("id")
                updated = supabase.table("focus_sessions").update(row).eq("id", session_id).eq("user_id", user_id).execute()
                updated_rows = updated.data or []
                if updated_rows:
                    session_id = updated_rows[0].get("id", session_id)

        if session_id is None:
            inserted = supabase.table("focus_sessions").insert(row).execute()
            inserted_rows = inserted.data or []
            session_id = inserted_rows[0].get("id") if inserted_rows else None

        return jsonify({"ok": True, "id": session_id})
    except Exception as exc:
        return _json_error("Failed to store focus session", 500, {"reason": str(exc)})


@app.route("/api/focus-sessions", methods=["GET"])
def list_focus_sessions():
    supabase = _get_supabase_client()
    user_id, user_error = _get_request_user_id()
    if user_error:
        return _json_error("Unauthorized", 401, {"reason": user_error})

    from_date = (request.args.get("from") or "").strip()
    to_date = (request.args.get("to") or "").strip()

    try:
        query = supabase.table("focus_sessions").select("*").eq("user_id", user_id).order("id", desc=True).limit(100)
        if from_date:
            query = query.gte("ended_at", from_date)
        if to_date:
            query = query.lte("ended_at", f"{to_date}T23:59:59.999999+00:00")

        result = query.execute()
        sessions = result.data or []

        total_sessions = len(sessions)
        total_session_ms = sum(int(item.get("session_ms") or 0) for item in sessions)
        total_focus_ms = sum(int(item.get("focus_ms") or 0) for item in sessions)
        total_distractions = sum(int(item.get("distraction_count") or 0) for item in sessions)
        avg_focus_rate = 0.0
        if total_sessions > 0:
            avg_focus_rate = sum(float(item.get("focus_rate") or 0.0) for item in sessions) / total_sessions

        summary = {
            "total_sessions": total_sessions,
            "total_session_ms": total_session_ms,
            "total_focus_ms": total_focus_ms,
            "avg_focus_rate": avg_focus_rate,
            "total_distractions": total_distractions,
        }

        return jsonify({"sessions": sessions, "summary": summary})
    except Exception as exc:
        return _json_error("Failed to fetch focus sessions", 500, {"reason": str(exc)})


@app.route("/api/focus-sessions", methods=["DELETE"])
def delete_focus_sessions():
    supabase = _get_supabase_client()
    user_id, user_error = _get_request_user_id()
    if user_error:
        return _json_error("Unauthorized", 401, {"reason": user_error})

    try:
        supabase.table("focus_sessions").delete().eq("user_id", user_id).execute()
        return jsonify({"ok": True, "message": "All history cleared successfully"})
    except Exception as exc:
        return _json_error("Failed to clear history", 500, {"reason": str(exc)})


@app.route("/api/velocity", methods=["GET"])
def developer_velocity():
    user_id, user_error = _get_request_user_id()
    if user_error:
        return _json_error("Unauthorized", 401, {"reason": user_error})
    if not user_id:
        return _json_error("Unable to resolve user context", 400)

    completed_tasks, tasks_error = _fetch_completed_graph_tasks_for_velocity()
    if tasks_error:
        return _json_error("Failed to fetch completed Microsoft tasks", 500, {"reason": tasks_error})

    focus_by_task_key, total_focus_minutes, focus_error = _fetch_focus_minutes_index_for_velocity(user_id)
    if focus_error:
        return _json_error("Failed to fetch focus session logs", 500, {"reason": focus_error})

    task_efficiency_list = _build_velocity_efficiency_list(completed_tasks, focus_by_task_key)

    total_hours = round(total_focus_minutes / 60.0, 2)
    completed_task_count = len(completed_tasks)
    velocity_score = 0.0
    if total_hours > 0:
        velocity_score = round(completed_task_count / total_hours, 4)

    payload_for_cipher = {
        "tasks_completed": completed_task_count,
        "total_focus_hours": total_hours,
        "velocity_score": velocity_score,
        "task_efficiency_list": task_efficiency_list,
    }
    cipher_critique = _generate_cipher_velocity_critique(_get_ai_api_key(), payload_for_cipher)

    return jsonify(
        {
            "velocity_score": velocity_score,
            "total_hours": total_hours,
            "task_efficiency_list": task_efficiency_list,
            "cipher_critique": cipher_critique,
        }
    )


@app.route("/api/todos", methods=["GET"])
def list_todos():
    supabase = _get_supabase_client()
    user_id, user_error = _get_request_user_id()
    if user_error:
        return _json_error("Unauthorized", 401, {"reason": user_error})

    try:
        result = supabase.table("todos").select("*").eq("user_id", user_id).order("is_done").order("id", desc=True).execute()
        rows = result.data or []
        todos = [_serialize_todo(row) for row in rows]
        return jsonify({"todos": todos})
    except Exception as exc:
        return _json_error("Failed to fetch todos", 500, {"reason": str(exc)})


@app.route("/api/todos", methods=["POST"])
def create_todo():
    supabase = _get_supabase_client()
    user_id, user_error = _get_request_user_id()
    if user_error:
        return _json_error("Unauthorized", 401, {"reason": user_error})

    payload = _read_json()
    title = str(payload.get("title", "")).strip()
    raw_due_date = payload.get("dueDate")
    due_date = str(raw_due_date).strip() if raw_due_date is not None else None

    if not title:
        return _json_error("Title is required", 400)

    if due_date:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", due_date):
            return _json_error("dueDate must be in YYYY-MM-DD format", 400)
    else:
        due_date = None

    now_iso = _utc_now_iso()

    try:
        created = (
            supabase.table("todos")
            .insert(
                {
                    "user_id": user_id,
                    "title": title,
                    "is_done": False,
                    "due_date": due_date,
                    "created_at": now_iso,
                    "updated_at": now_iso,
                }
            )
            .execute()
        )
        rows = created.data or []
        if not rows:
            return _json_error("Todo creation failed", 500)

        return jsonify({"todo": _serialize_todo(rows[0])}), 201
    except Exception as exc:
        return _json_error("Failed to create todo", 500, {"reason": str(exc)})


@app.route("/api/todos/<int:todo_id>", methods=["PATCH"])
def update_todo(todo_id: int):
    supabase = _get_supabase_client()
    user_id, user_error = _get_request_user_id()
    if user_error:
        return _json_error("Unauthorized", 401, {"reason": user_error})

    payload = _read_json()
    if "title" not in payload and "isDone" not in payload and "dueDate" not in payload:
        return _json_error("Nothing to update", 400)

    try:
        existing_result = supabase.table("todos").select("*").eq("id", todo_id).eq("user_id", user_id).limit(1).execute()
        existing_rows = existing_result.data or []
        if not existing_rows:
            return _json_error("Todo not found", 404)

        existing = existing_rows[0]
        updates: Dict[str, Any] = {}

        if "title" in payload:
            candidate = str(payload.get("title", "")).strip()
            if not candidate:
                return _json_error("Title cannot be empty", 400)
            updates["title"] = candidate

        if "isDone" in payload:
            updates["is_done"] = bool(payload.get("isDone"))

        if "dueDate" in payload:
            candidate_due = payload.get("dueDate")
            if candidate_due is None:
                updates["due_date"] = None
            else:
                candidate_due_value = str(candidate_due).strip()
                if candidate_due_value:
                    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", candidate_due_value):
                        return _json_error("dueDate must be in YYYY-MM-DD format", 400)
                    updates["due_date"] = candidate_due_value
                else:
                    updates["due_date"] = None

        if not updates:
            return jsonify({"todo": _serialize_todo(existing)})

        updates["updated_at"] = _utc_now_iso()

        updated_result = supabase.table("todos").update(updates).eq("id", todo_id).eq("user_id", user_id).execute()
        updated_rows = updated_result.data or []
        if not updated_rows:
            return _json_error("Todo update failed", 500)

        return jsonify({"todo": _serialize_todo(updated_rows[0])})
    except Exception as exc:
        return _json_error("Failed to update todo", 500, {"reason": str(exc)})


@app.route("/api/todos/<int:todo_id>", methods=["DELETE"])
def delete_todo(todo_id: int):
    supabase = _get_supabase_client()
    user_id, user_error = _get_request_user_id()
    if user_error:
        return _json_error("Unauthorized", 401, {"reason": user_error})

    try:
        existing_result = supabase.table("todos").select("id").eq("id", todo_id).eq("user_id", user_id).limit(1).execute()
        existing_rows = existing_result.data or []
        if not existing_rows:
            return _json_error("Todo not found", 404)

        supabase.table("todos").delete().eq("id", todo_id).eq("user_id", user_id).execute()
        return jsonify({"ok": True})
    except Exception as exc:
        return _json_error("Failed to delete todo", 500, {"reason": str(exc)})


# Tasks aliases for API compatibility if clients use /api/tasks instead of /api/todos.
@app.route("/api/tasks", methods=["GET", "POST"])
def tasks_alias_collection():
    if request.method == "GET":
        return list_todos()
    return create_todo()


@app.route("/api/tasks/<int:todo_id>", methods=["PATCH", "DELETE"])
def tasks_alias_item(todo_id: int):
    if request.method == "PATCH":
        return update_todo(todo_id)
    return delete_todo(todo_id)


@app.route("/api/health", methods=["GET"])
def health():
    graph_token, graph_error = _acquire_graph_token()

    return jsonify(
        {
            "ok": True,
            "supabaseConfigured": True,
            "graphConfigured": graph_error is None,
            "graphAuthReady": graph_token is not None,
            "provider": _infer_ai_provider(_get_ai_api_key()) if _get_ai_api_key() else None,
        }
    )


@app.errorhandler(404)
def not_found(_error):
    return _json_error("Not found", 404)


@app.errorhandler(405)
def method_not_allowed(_error):
    return _json_error("Method not allowed", 405)


@app.errorhandler(500)
def internal_error(_error):
    return _json_error("Internal server error", 500)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=True)
