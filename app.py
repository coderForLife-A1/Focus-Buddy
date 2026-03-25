from flask import Flask, request, jsonify, send_from_directory
import importlib.util
import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from urllib import error as urlerror
from urllib import request as urlrequest

app = Flask(__name__)
DB_PATH = 'database.db'

# Ensure database and table exist
def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            email TEXT
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS focus_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_session_id TEXT,
            started_at TEXT NOT NULL,
            ended_at TEXT NOT NULL,
            session_ms INTEGER NOT NULL,
            focus_ms INTEGER NOT NULL,
            focus_rate REAL NOT NULL,
            distraction_count INTEGER NOT NULL,
            created_at TEXT NOT NULL
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS todos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            is_done INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    ''')

    # Backward-compatible migration for existing databases.
    existing_columns = [row[1] for row in c.execute("PRAGMA table_info(focus_sessions)").fetchall()]
    if 'client_session_id' not in existing_columns:
        c.execute('ALTER TABLE focus_sessions ADD COLUMN client_session_id TEXT')

    todo_columns = [row[1] for row in c.execute("PRAGMA table_info(todos)").fetchall()]
    if todo_columns:
        if 'is_done' not in todo_columns:
            c.execute('ALTER TABLE todos ADD COLUMN is_done INTEGER NOT NULL DEFAULT 0')
        if 'created_at' not in todo_columns:
            c.execute('ALTER TABLE todos ADD COLUMN created_at TEXT')
            c.execute(
                'UPDATE todos SET created_at = ? WHERE created_at IS NULL OR created_at = ""',
                (datetime.now(timezone.utc).isoformat(),),
            )
        if 'updated_at' not in todo_columns:
            c.execute('ALTER TABLE todos ADD COLUMN updated_at TEXT')
            c.execute(
                'UPDATE todos SET updated_at = ? WHERE updated_at IS NULL OR updated_at = ""',
                (datetime.now(timezone.utc).isoformat(),),
            )

    conn.commit()
    conn.close()

init_db()

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def get_ai_api_key():
    env_key = os.getenv('AI_API_KEY', '').strip()
    if env_key:
        return env_key

    def load_key_from_module_file(file_name):
        file_path = os.path.join(os.path.dirname(__file__), file_name)
        if not os.path.exists(file_path):
            return ''
        try:
            spec = importlib.util.spec_from_file_location(file_name.replace('.py', ''), file_path)
            if spec is None or spec.loader is None:
                return ''
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            key = str(getattr(module, 'AI_API_KEY', '')).strip()
            return key
        except Exception:
            return ''

    local_key = load_key_from_module_file('ai_config_local.py')
    if local_key:
        return local_key

    fallback_key = load_key_from_module_file('ai_config.py')
    if fallback_key:
        return fallback_key

    return ''


def split_sentences(text):
    if not text:
        return []
    normalized = re.sub(r'\s+', ' ', str(text)).strip()
    if not normalized:
        return []
    return [s.strip() for s in re.split(r'(?<=[.!?])\s+', normalized) if s.strip()]


def fallback_extract_summary(text, ratio_percent):
    sentences = split_sentences(text)
    if not sentences:
        return {'summary': '', 'sourceSentences': 0, 'summarySentences': 0, 'sourceWords': 0}

    source_words = len(re.findall(r"\b[\w']+\b", text))
    target_count = max(1, min(12, round((ratio_percent / 100.0) * len(sentences))))
    picked = sentences[:target_count]

    return {
        'summary': ' '.join(picked),
        'sourceSentences': len(sentences),
        'summarySentences': len(picked),
        'sourceWords': source_words,
    }


def build_local_summary_response(local_summary, warning, ai_error=None):
    response = {
        'summary': local_summary['summary'],
        'sourceSentences': local_summary['sourceSentences'],
        'summarySentences': local_summary['summarySentences'],
        'sourceWords': local_summary['sourceWords'],
        'usedFallback': True,
        'provider': 'local',
        'warning': warning,
    }
    if ai_error:
        response['aiError'] = ai_error
    return response


def infer_ai_provider(api_key):
    configured_provider = os.getenv('AI_PROVIDER', '').strip().lower()
    if configured_provider in ('openai', 'gemini', 'claude'):
        return configured_provider

    if str(api_key).startswith('AIza'):
        return 'gemini'
    if str(api_key).startswith('sk-ant-'):
        return 'claude'
    if str(api_key).startswith('sk-'):
        return 'openai'

    return 'openai'


def ai_summarize_with_openai(api_key, text, ratio_percent):
    sentences = split_sentences(text)
    sentence_goal = max(1, min(12, round((ratio_percent / 100.0) * max(1, len(sentences)))))

    payload = {
        'model': 'gpt-4o-mini',
        'temperature': 0.2,
        'messages': [
            {
                'role': 'system',
                'content': 'You are a concise summarizer. Return only the final summary text without headings.'
            },
            {
                'role': 'user',
                'content': (
                    f'Summarize the following content in about {sentence_goal} sentences. '
                    f'Keep the most important points and keep it factual.\n\n{text}'
                )
            },
        ],
    }

    request_data = json.dumps(payload).encode('utf-8')
    req = urlrequest.Request(
        'https://api.openai.com/v1/chat/completions',
        data=request_data,
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {api_key}',
        },
        method='POST',
    )

    with urlrequest.urlopen(req, timeout=60) as response:
        body = response.read().decode('utf-8')
        parsed = json.loads(body)
        choices = parsed.get('choices') or []
        if not choices:
            raise ValueError('No choices returned by AI provider')
        message = choices[0].get('message') or {}
        summary = str(message.get('content') or '').strip()
        if not summary:
            raise ValueError('Empty summary returned by AI provider')
        return summary


def ai_summarize_with_gemini(api_key, text, ratio_percent):
    sentences = split_sentences(text)
    sentence_goal = max(1, min(12, round((ratio_percent / 100.0) * max(1, len(sentences)))))

    prompt_text = (
        f'Summarize the following content in about {sentence_goal} sentences. '
        f'Keep the most important points and keep it factual. '
        'Return only the final summary text without headings.\n\n'
        f'{text}'
    )

    payload = {
        'contents': [
            {
                'parts': [
                    {
                        'text': prompt_text,
                    }
                ]
            }
        ],
        'generationConfig': {
            'temperature': 0.2,
        },
    }

    request_data = json.dumps(payload).encode('utf-8')
    model_candidates = ['gemini-1.5-flash-latest', 'gemini-1.5-flash', 'gemini-2.0-flash']
    last_http_error = None

    for model_name in model_candidates:
        req = urlrequest.Request(
            f'https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}',
            data=request_data,
            headers={
                'Content-Type': 'application/json',
            },
            method='POST',
        )

        try:
            with urlrequest.urlopen(req, timeout=60) as response:
                body = response.read().decode('utf-8')
                parsed = json.loads(body)

                candidates = parsed.get('candidates') or []
                if not candidates:
                    feedback = parsed.get('promptFeedback') or {}
                    block_reason = feedback.get('blockReason')
                    if block_reason:
                        raise ValueError(f'Gemini blocked prompt: {block_reason}')
                    raise ValueError('No candidates returned by AI provider')

                content = candidates[0].get('content') or {}
                parts = content.get('parts') or []
                summary_parts = [str(part.get('text') or '').strip() for part in parts if part.get('text')]
                summary = ' '.join(summary_parts).strip()
                if not summary:
                    raise ValueError('Empty summary returned by AI provider')
                return summary
        except urlerror.HTTPError as exc:
            if int(getattr(exc, 'code', 0) or 0) == 404:
                last_http_error = exc
                continue
            raise

    if last_http_error is not None:
        raise last_http_error

    raise ValueError('Gemini model resolution failed')


def ai_summarize_with_claude(api_key, text, ratio_percent):
    sentences = split_sentences(text)
    sentence_goal = max(1, min(12, round((ratio_percent / 100.0) * max(1, len(sentences)))))

    model_candidates = ['claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest']
    system_prompt = 'You are a concise summarizer. Return only the final summary text without headings.'
    user_prompt = (
        f'Summarize the following content in about {sentence_goal} sentences. '
        f'Keep the most important points and keep it factual.\n\n{text}'
    )

    last_http_error = None
    for model_name in model_candidates:
        payload = {
            'model': model_name,
            'max_tokens': 600,
            'temperature': 0.2,
            'system': system_prompt,
            'messages': [
                {
                    'role': 'user',
                    'content': user_prompt,
                }
            ],
        }

        req = urlrequest.Request(
            'https://api.anthropic.com/v1/messages',
            data=json.dumps(payload).encode('utf-8'),
            headers={
                'Content-Type': 'application/json',
                'x-api-key': api_key,
                'anthropic-version': '2023-06-01',
            },
            method='POST',
        )

        try:
            with urlrequest.urlopen(req, timeout=60) as response:
                body = response.read().decode('utf-8')
                parsed = json.loads(body)

                content = parsed.get('content') or []
                summary_parts = [
                    str(item.get('text') or '').strip()
                    for item in content
                    if str(item.get('type') or '') == 'text' and item.get('text')
                ]
                summary = ' '.join(summary_parts).strip()
                if not summary:
                    raise ValueError('Empty summary returned by AI provider')
                return summary
        except urlerror.HTTPError as exc:
            status_code = int(getattr(exc, 'code', 0) or 0)
            if status_code in (400, 404):
                last_http_error = exc
                continue
            raise

    if last_http_error is not None:
        raise last_http_error

    raise ValueError('Claude model resolution failed')


@app.route('/', methods=['GET'])
@app.route('/index.html', methods=['GET'])
def index():
    return send_from_directory('.', 'index.html')


@app.route('/history', methods=['GET'])
@app.route('/history.html', methods=['GET'])
def history_page():
    return send_from_directory('.', 'history.html')


@app.route('/todo', methods=['GET'])
@app.route('/todo.html', methods=['GET'])
def todo_page():
    return send_from_directory('.', 'todo.html')


@app.route('/ai-summarizer', methods=['GET'])
@app.route('/ai_summarizer.html', methods=['GET'])
def ai_summarizer_page():
    return send_from_directory('.', 'ai_summarizer.html')


@app.route('/calendar', methods=['GET'])
@app.route('/calendar.html', methods=['GET'])
def calendar_page():
    return send_from_directory('.', 'calendar.html')


@app.route('/api/ai-config', methods=['GET'])
def ai_config():
    api_key = get_ai_api_key()
    provider = infer_ai_provider(api_key) if api_key else None
    return jsonify({'hasApiKey': bool(api_key), 'provider': provider}), 200


@app.route('/api/ai-summarize', methods=['POST'])
def ai_summarize():
    payload = request.get_json(silent=True) or {}
    source_text = str(payload.get('text') or '').strip()
    ratio_percent = payload.get('ratioPercent', 25)

    try:
        ratio_percent = float(ratio_percent)
    except (TypeError, ValueError):
        ratio_percent = 25.0

    ratio_percent = max(10.0, min(50.0, ratio_percent))

    if not source_text:
        return jsonify({'error': 'Text is required'}), 400

    local_summary = fallback_extract_summary(source_text, ratio_percent)
    api_key = get_ai_api_key()

    if not api_key:
        return jsonify(
            build_local_summary_response(
                local_summary,
                'No AI API key configured. Returned local summary.',
                {'type': 'missing_api_key'},
            )
        ), 200

    try:
        provider = infer_ai_provider(api_key)
        if provider == 'gemini':
            ai_summary = ai_summarize_with_gemini(api_key, source_text, ratio_percent)
        elif provider == 'claude':
            ai_summary = ai_summarize_with_claude(api_key, source_text, ratio_percent)
        else:
            ai_summary = ai_summarize_with_openai(api_key, source_text, ratio_percent)

        summary_sentences = len(split_sentences(ai_summary))

        return jsonify(
            {
                'summary': ai_summary,
                'sourceSentences': local_summary['sourceSentences'],
                'summarySentences': summary_sentences,
                'sourceWords': local_summary['sourceWords'],
                'usedFallback': False,
                'provider': provider,
            }
        ), 200
    except urlerror.HTTPError as exc:
        return jsonify(
            build_local_summary_response(
                local_summary,
                'AI provider rejected the request. Returned local summary.',
                {
                    'type': 'http_error',
                    'status': int(getattr(exc, 'code', 0) or 0),
                    'reason': str(getattr(exc, 'reason', '') or ''),
                    'provider': infer_ai_provider(api_key),
                },
            )
        ), 200
    except urlerror.URLError as exc:
        return jsonify(
            build_local_summary_response(
                local_summary,
                'AI provider unavailable. Returned local summary.',
                {
                    'type': 'network_error',
                    'reason': str(getattr(exc, 'reason', '') or str(exc)),
                    'provider': infer_ai_provider(api_key),
                },
            )
        ), 200
    except (ValueError, KeyError, json.JSONDecodeError) as exc:
        return jsonify(
            build_local_summary_response(
                local_summary,
                'AI provider response was invalid. Returned local summary.',
                {
                    'type': 'parse_error',
                    'reason': str(exc),
                    'provider': infer_ai_provider(api_key),
                },
            )
        ), 200


@app.route('/api/focus-sessions', methods=['POST'])
def create_focus_session():
    payload = request.get_json(silent=True) or {}

    required = ['startedAt', 'endedAt', 'sessionMs', 'focusMs', 'focusRate', 'distractionCount']
    missing = [field for field in required if field not in payload]
    if missing:
        return jsonify({'error': f"Missing required fields: {', '.join(missing)}"}), 400

    try:
        session_ms = int(payload['sessionMs'])
        focus_ms = int(payload['focusMs'])
        focus_rate = float(payload['focusRate'])
        distraction_count = int(payload['distractionCount'])
    except (TypeError, ValueError):
        return jsonify({'error': 'Invalid numeric values in payload'}), 400

    if session_ms < 0 or focus_ms < 0 or distraction_count < 0:
        return jsonify({'error': 'Metrics cannot be negative'}), 400

    if focus_ms > session_ms:
        focus_ms = session_ms

    focus_rate = max(0.0, min(focus_rate, 100.0))

    created_at = datetime.now(timezone.utc).isoformat()
    client_session_id = payload.get('clientSessionId')

    conn = get_conn()
    cursor = conn.cursor()

    session_id = None
    if client_session_id:
        existing = conn.execute(
            'SELECT id FROM focus_sessions WHERE client_session_id = ? LIMIT 1',
            (client_session_id,),
        ).fetchone()
        if existing:
            session_id = existing['id']
            cursor.execute(
                '''
                UPDATE focus_sessions
                SET
                    started_at = ?,
                    ended_at = ?,
                    session_ms = ?,
                    focus_ms = ?,
                    focus_rate = ?,
                    distraction_count = ?,
                    created_at = ?
                WHERE id = ?
                ''',
                (
                    payload['startedAt'],
                    payload['endedAt'],
                    session_ms,
                    focus_ms,
                    focus_rate,
                    distraction_count,
                    created_at,
                    session_id,
                ),
            )

    if session_id is None:
        cursor.execute(
            '''
            INSERT INTO focus_sessions (
                client_session_id,
                started_at,
                ended_at,
                session_ms,
                focus_ms,
                focus_rate,
                distraction_count,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                client_session_id,
                payload['startedAt'],
                payload['endedAt'],
                session_ms,
                focus_ms,
                focus_rate,
                distraction_count,
                created_at,
            ),
        )
        session_id = cursor.lastrowid

    conn.commit()
    conn.close()

    return jsonify({'ok': True, 'id': session_id}), 200


@app.route('/api/focus-sessions', methods=['GET'])
def list_focus_sessions():
    from_date = request.args.get('from')
    to_date = request.args.get('to')

    where_clauses = []
    params = []
    if from_date:
        where_clauses.append('date(ended_at) >= date(?)')
        params.append(from_date)
    if to_date:
        where_clauses.append('date(ended_at) <= date(?)')
        params.append(to_date)

    where_sql = ''
    if where_clauses:
        where_sql = 'WHERE ' + ' AND '.join(where_clauses)

    conn = get_conn()
    rows = conn.execute(
        f'''
        SELECT
            id,
            client_session_id,
            started_at,
            ended_at,
            session_ms,
            focus_ms,
            focus_rate,
            distraction_count,
            created_at
        FROM focus_sessions
        {where_sql}
        ORDER BY id DESC
        LIMIT 100
        '''
        ,
        params,
    ).fetchall()

    summary = conn.execute(
        f'''
        SELECT
            COUNT(*) AS total_sessions,
            COALESCE(SUM(session_ms), 0) AS total_session_ms,
            COALESCE(SUM(focus_ms), 0) AS total_focus_ms,
            COALESCE(AVG(focus_rate), 0) AS avg_focus_rate,
            COALESCE(SUM(distraction_count), 0) AS total_distractions
        FROM focus_sessions
        {where_sql}
        '''
        ,
        params,
    ).fetchone()
    conn.close()

    sessions = [dict(row) for row in rows]
    return jsonify({'sessions': sessions, 'summary': dict(summary)})


@app.route('/api/focus-sessions', methods=['DELETE'])
def delete_all_focus_sessions():
    """Delete all focus sessions from the database."""
    try:
        conn = get_conn()
        conn.execute('DELETE FROM focus_sessions')
        conn.commit()
        conn.close()
        return jsonify({'ok': True, 'message': 'All history cleared successfully'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/todos', methods=['GET'])
def list_todos():
    conn = get_conn()
    rows = conn.execute(
        '''
        SELECT
            id,
            title,
            is_done,
            created_at,
            updated_at
        FROM todos
        ORDER BY is_done ASC, id DESC
        '''
    ).fetchall()
    conn.close()

    todos = [
        {
            'id': row['id'],
            'title': row['title'],
            'isDone': bool(row['is_done']),
            'createdAt': row['created_at'],
            'updatedAt': row['updated_at'],
        }
        for row in rows
    ]
    return jsonify({'todos': todos}), 200


@app.route('/api/todos', methods=['POST'])
def create_todo():
    payload = request.get_json(silent=True) or {}
    raw_title = payload.get('title', '')
    title = str(raw_title).strip()

    if not title:
        return jsonify({'error': 'Title is required'}), 400

    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute(
        '''
        INSERT INTO todos (title, is_done, created_at, updated_at)
        VALUES (?, 0, ?, ?)
        ''',
        (title, now_iso, now_iso),
    )
    todo_id = cursor.lastrowid
    conn.commit()
    row = conn.execute(
        '''
        SELECT id, title, is_done, created_at, updated_at
        FROM todos
        WHERE id = ?
        ''',
        (todo_id,),
    ).fetchone()
    conn.close()

    return jsonify(
        {
            'todo': {
                'id': row['id'],
                'title': row['title'],
                'isDone': bool(row['is_done']),
                'createdAt': row['created_at'],
                'updatedAt': row['updated_at'],
            }
        }
    ), 201


@app.route('/api/todos/<int:todo_id>', methods=['PATCH'])
def update_todo(todo_id):
    payload = request.get_json(silent=True) or {}

    if 'title' not in payload and 'isDone' not in payload:
        return jsonify({'error': 'Nothing to update'}), 400

    conn = get_conn()
    existing = conn.execute(
        'SELECT id, title, is_done, created_at, updated_at FROM todos WHERE id = ?',
        (todo_id,),
    ).fetchone()
    if not existing:
        conn.close()
        return jsonify({'error': 'Todo not found'}), 404

    new_title = existing['title']
    new_is_done = existing['is_done']

    if 'title' in payload:
        candidate = str(payload.get('title', '')).strip()
        if not candidate:
            conn.close()
            return jsonify({'error': 'Title cannot be empty'}), 400
        new_title = candidate

    if 'isDone' in payload:
        new_is_done = 1 if bool(payload.get('isDone')) else 0

    now_iso = datetime.now(timezone.utc).isoformat()
    conn.execute(
        '''
        UPDATE todos
        SET title = ?, is_done = ?, updated_at = ?
        WHERE id = ?
        ''',
        (new_title, new_is_done, now_iso, todo_id),
    )
    conn.commit()
    row = conn.execute(
        'SELECT id, title, is_done, created_at, updated_at FROM todos WHERE id = ?',
        (todo_id,),
    ).fetchone()
    conn.close()

    return jsonify(
        {
            'todo': {
                'id': row['id'],
                'title': row['title'],
                'isDone': bool(row['is_done']),
                'createdAt': row['created_at'],
                'updatedAt': row['updated_at'],
            }
        }
    ), 200


@app.route('/api/todos/<int:todo_id>', methods=['DELETE'])
def delete_todo(todo_id):
    conn = get_conn()
    existing = conn.execute('SELECT id FROM todos WHERE id = ?', (todo_id,)).fetchone()
    if not existing:
        conn.close()
        return jsonify({'error': 'Todo not found'}), 404

    conn.execute('DELETE FROM todos WHERE id = ?', (todo_id,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True}), 200

if __name__ == '__main__':
    app.run(debug=True)