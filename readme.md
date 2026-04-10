# FocusBuddy

FocusBuddy is a productivity web app with a static frontend and a Python Flask backend.

## Current Stack

- Frontend: Static HTML/CSS/JavaScript in `frontend/`
- Backend: Flask app in `api/index.py`
- Database: Supabase (Postgres)
- Deployment routing: `vercel.json` rewrites `/api/*` to `api/index.py`

## Project Structure

```
Focus Buddy/
├── api/
│   ├── .env
│   ├── ai_config.py
│   ├── ai_config_local.py
│   ├── index.py
│   ├── requirements.txt
│   └── schema.sql
├── frontend/
│   ├── index.html
│   ├── todo.html
│   ├── history.html
│   ├── calendar.html
│   ├── ai_summarizer.html
│   ├── interactive-bg.css
│   └── interactive-bg.js
├── vercel.json
├── LICENSE
└── readme.md
```

## Features

- Focus timer and focus session tracking
- Focus history analytics
- Todo management with due dates
- Calendar view
- AI summarizer with provider inference and local fallback

## API Routes

All backend routes are exposed under `/api`:

- OPTIONS `/api/<path>`
- GET `/api/health`
- GET `/api/ai-config`
- GET `/api/graph-auth`
- POST `/api/ai-summarize`
- GET `/api/focus-sessions`
- POST `/api/focus-sessions`
- DELETE `/api/focus-sessions`
- GET `/api/todos`
- POST `/api/todos`
- PATCH `/api/todos/{id}`
- DELETE `/api/todos/{id}`
- GET `/api/tasks` (alias of todos)
- POST `/api/tasks` (alias of todos)
- PATCH `/api/tasks/{id}` (alias of todos)
- DELETE `/api/tasks/{id}` (alias of todos)
- GET `/api/microsoft-todo/status`
- GET `/api/microsoft-todo/lists`
- GET `/api/microsoft-todo/tasks`
- POST `/api/microsoft-todo/tasks` (returns `501` for write attempts with app-only auth)
- PATCH `/api/microsoft-todo/tasks/{taskId}` (returns `501` for write attempts with app-only auth)
- DELETE `/api/microsoft-todo/tasks/{taskId}` (returns `501` for write attempts with app-only auth)

## Environment Variables

Create `api/.env` with:

```env
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_legacy_jwt_service_role_key
```

Optional variables:

- `AI_API_KEY` or `OPENROUTER_API_KEY`
- `AI_PROVIDER` (`openai`, `openrouter`, `gemini`, `claude`)
- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
- `AZURE_TODO_USER_PRINCIPAL_NAME` or `GRAPH_TODO_USER_PRINCIPAL_NAME` if you want the Microsoft To Do route to default to a specific user
- `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_SCOPES` are still accepted as legacy aliases
- `PORT` (default `5000`)

Note: with the current dependency versions, use a JWT-style Supabase key for backend auth.

## Database Setup

Run the SQL in `api/schema.sql` once in Supabase SQL Editor to create required tables:

- `public.focus_sessions`
- `public.todos`

## Local Development

1. Install backend dependencies:

```bash
cd api
pip install -r requirements.txt
```

2. Start backend API:

```bash
python index.py
```

3. Serve frontend:

```bash
cd ../frontend
python -m http.server 5500
```

4. Open app:

```text
http://localhost:5500/index.html
```

If frontend and backend run on different origins locally, ensure requests target the backend URL (for example `http://127.0.0.1:5000/api/...`).

## Troubleshooting

- Invalid Supabase key on startup (`Invalid API key`):
	Use a JWT-style legacy `service_role` key in `SUPABASE_SERVICE_ROLE_KEY` (usually starts with `eyJ` and has three dot-separated parts).

- Microsoft To Do route returns `400`:
	Provide `userPrincipalName` or `userId` in the request query string, or set `AZURE_TODO_USER_PRINCIPAL_NAME` for a default user.

- Microsoft To Do write attempts return `501`:
	The current backend uses application credentials, which are enough for reading To Do data but not for create/update/delete on those Graph endpoints.

- Tables not found (`PGRST205` for `public.todos` or `public.focus_sessions`):
	Run `api/schema.sql` in Supabase SQL Editor, then retry the API calls.

- API health check:

```bash
curl http://127.0.0.1:5000/api/health
```

Expected: `{"ok": true, "supabaseConfigured": true, ...}`

- Database route checks:

```bash
curl http://127.0.0.1:5000/api/todos
curl http://127.0.0.1:5000/api/focus-sessions
```

If both routes return JSON (not 500 errors), database connectivity and schema are configured correctly.
