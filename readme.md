# FocusBuddy

FocusBuddy is a productivity web app with a static frontend and a Python Flask backend.

## Current Stack

- Frontend: React + Vite + Tailwind (`src/`)
- Backend: Flask app in `api/index.py`
- Database: Supabase (Postgres)
- Deployment routing: `vercel.json` routes `/api/*` to `api/index.py` and serves SPA from `dist/`

## Project Structure

```
Focus Buddy/
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   ├── index.css
│   └── components/
│       └── Dashboard.jsx
├── api/
│   ├── .env
│   ├── index.py
│   ├── requirements.txt
│   └── schema.sql
├── frontend/
│   ├── index.html
│   ├── todo.html
│   ├── history.html
│   ├── calendar.html
│   └── ai_summarizer.html
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── vercel.json
├── LICENSE
└── readme.md
```

## Features

- Focus dashboard with Aria command routing
- Focus history analytics (React route)
- Todo management with due dates + Microsoft To Do mode (React route)
- Calendar view with holiday overlay (React route)
- AI summarizer with provider inference and local fallback (React route)

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
- POST `/api/microsoft-todo/tasks` (requires Microsoft user login)
- PATCH `/api/microsoft-todo/tasks/{taskId}` (requires Microsoft user login)
- DELETE `/api/microsoft-todo/tasks/{taskId}` (requires Microsoft user login)
- GET `/api/auth/microsoft/login`
- GET `/api/auth/microsoft/callback`
- POST `/api/auth/microsoft/logout`
- GET `/api/auth/microsoft/status`

## Environment Variables

Create `api/.env` with:

```env
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_legacy_jwt_service_role_key
```

Optional variables:

- `OPENROUTER_API_KEY`
- `AI_PROVIDER` (`openrouter`)
- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
- `AZURE_AUTH_REDIRECT_URI` (optional; defaults to `{host}/api/auth/microsoft/callback`)
- `AZURE_DELEGATED_SCOPES` (optional; default `Tasks.ReadWrite`)
- `AZURE_TODO_USER_PRINCIPAL_NAME` or `GRAPH_TODO_USER_PRINCIPAL_NAME` for app-only fallback reads (optional if you use Microsoft login)
- `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_SCOPES` are still accepted as legacy aliases
- `FLASK_SECRET_KEY` or `SESSION_SECRET` (strongly recommended for stable login sessions)
- `CORS_ALLOW_ORIGINS` (comma-separated, for example `http://localhost:5500`)
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

3. Install frontend dependencies:

```bash
npm install
```

4. Start Vite frontend:

```bash
npm run dev
```

5. Open app:

```text
http://localhost:5173
```

## Troubleshooting

- Invalid Supabase key on startup (`Invalid API key`):
	Use a JWT-style legacy `service_role` key in `SUPABASE_SERVICE_ROLE_KEY` (usually starts with `eyJ` and has three dot-separated parts).

- Microsoft To Do route returns `400`:
	If you are not logged in with Microsoft and app-only fallback is used, set `AZURE_TODO_USER_PRINCIPAL_NAME`.

- Microsoft To Do write attempts return `401`:
	Sign in through `/api/auth/microsoft/login` first. Write operations are enabled only with delegated user auth.

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
