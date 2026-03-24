from flask import Flask, request, jsonify, send_from_directory
import sqlite3
from datetime import datetime, timezone

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


@app.route('/', methods=['GET'])
@app.route('/index.html', methods=['GET'])
def index():
    return send_from_directory('.', 'index.html')


@app.route('/history', methods=['GET'])
@app.route('/history.html', methods=['GET'])
def history_page():
    return send_from_directory('.', 'history.html')


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