import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from urllib import error as urlerror
from urllib import request as urlrequest

import msal
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from supabase import Client, create_client

load_dotenv()
load_dotenv(Path(__file__).resolve().parent / ".env")

app = Flask(__name__)


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
    primary = os.getenv("AI_API_KEY", "").strip()
    if primary:
        return primary

    openrouter_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if openrouter_key:
        return openrouter_key

    return ""


def _ai_summarize_with_openrouter(api_key: str, text: str, ratio_percent: float) -> str:
    sentences = _split_sentences(text)
    sentence_goal = max(1, min(12, round((ratio_percent / 100.0) * max(1, len(sentences)))))

    fallback_models = [
        "qwen/qwen3.6-plus:free",
        "meta-llama/llama-3.1-8b-instruct:free",
        "openrouter/free",
    ]
    last_error = None

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
                    last_error = ValueError(f"No choices returned by model {current_model}")
                    continue

                message = choices[0].get("message") or {}
                summary = str(message.get("content") or "").strip()
                if not summary:
                    last_error = ValueError(f"Empty summary returned by model {current_model}")
                    continue

                return summary
        except (urlerror.HTTPError, urlerror.URLError, TimeoutError, ValueError, KeyError, json.JSONDecodeError) as exc:
            last_error = exc
            continue

    if last_error is not None:
        raise last_error
    raise ValueError("OpenRouter model fallback failed")


def _get_supabase_client() -> Client:
    return _ensure_supabase_client()


def _serialize_todo(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row.get("id"),
        "title": row.get("title"),
        "isDone": bool(row.get("is_done")),
        "dueDate": row.get("due_date"),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
    }


def _build_graph_client() -> Tuple[Optional[msal.ConfidentialClientApplication], Optional[str], Optional[list]]:
    tenant_id = os.getenv("GRAPH_TENANT_ID", "").strip()
    client_id = os.getenv("GRAPH_CLIENT_ID", "").strip()
    client_secret = os.getenv("GRAPH_CLIENT_SECRET", "").strip()
    scopes_raw = os.getenv("GRAPH_SCOPES", "https://graph.microsoft.com/.default").strip()

    missing_vars = []
    if not tenant_id:
        missing_vars.append("GRAPH_TENANT_ID")
    if not client_id:
        missing_vars.append("GRAPH_CLIENT_ID")
    if not client_secret:
        missing_vars.append("GRAPH_CLIENT_SECRET")

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


@app.after_request
def _add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,PATCH,DELETE,OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type,Authorization"
    return response


@app.route("/api/<path:_path>", methods=["OPTIONS"])
def options_handler(_path: str):
    return "", 204


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
        ai_summary = _ai_summarize_with_openrouter(api_key, source_text, ratio_percent)

        return jsonify(
            {
                "summary": ai_summary,
                "sourceSentences": local_summary["sourceSentences"],
                "summarySentences": len(_split_sentences(ai_summary)),
                "sourceWords": local_summary["sourceWords"],
                "usedFallback": False,
                "provider": provider,
            }
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


@app.route("/api/focus-sessions", methods=["POST"])
def create_focus_session():
    supabase = _get_supabase_client()

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
                .eq("client_session_id", client_session_id)
                .limit(1)
                .execute()
            )
            existing_rows = existing.data or []
            if existing_rows:
                session_id = existing_rows[0].get("id")
                updated = supabase.table("focus_sessions").update(row).eq("id", session_id).execute()
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

    from_date = (request.args.get("from") or "").strip()
    to_date = (request.args.get("to") or "").strip()

    try:
        query = supabase.table("focus_sessions").select("*").order("id", desc=True).limit(100)
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

    try:
        supabase.table("focus_sessions").delete().gt("id", -1).execute()
        return jsonify({"ok": True, "message": "All history cleared successfully"})
    except Exception as exc:
        return _json_error("Failed to clear history", 500, {"reason": str(exc)})


@app.route("/api/todos", methods=["GET"])
def list_todos():
    supabase = _get_supabase_client()

    try:
        result = supabase.table("todos").select("*").order("is_done").order("id", desc=True).execute()
        rows = result.data or []
        todos = [_serialize_todo(row) for row in rows]
        return jsonify({"todos": todos})
    except Exception as exc:
        return _json_error("Failed to fetch todos", 500, {"reason": str(exc)})


@app.route("/api/todos", methods=["POST"])
def create_todo():
    supabase = _get_supabase_client()

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

    payload = _read_json()
    if "title" not in payload and "isDone" not in payload and "dueDate" not in payload:
        return _json_error("Nothing to update", 400)

    try:
        existing_result = supabase.table("todos").select("*").eq("id", todo_id).limit(1).execute()
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

        updated_result = supabase.table("todos").update(updates).eq("id", todo_id).execute()
        updated_rows = updated_result.data or []
        if not updated_rows:
            return _json_error("Todo update failed", 500)

        return jsonify({"todo": _serialize_todo(updated_rows[0])})
    except Exception as exc:
        return _json_error("Failed to update todo", 500, {"reason": str(exc)})


@app.route("/api/todos/<int:todo_id>", methods=["DELETE"])
def delete_todo(todo_id: int):
    supabase = _get_supabase_client()

    try:
        existing_result = supabase.table("todos").select("id").eq("id", todo_id).limit(1).execute()
        existing_rows = existing_result.data or []
        if not existing_rows:
            return _json_error("Todo not found", 404)

        supabase.table("todos").delete().eq("id", todo_id).execute()
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
