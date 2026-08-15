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

- Focus dashboard with Cipher command routing
- Hey Cipher wake-word voice listening in the dashboard
- Focus history analytics (React route)
- Todo management with due dates (React route)
- Calendar view with holiday overlay (React route)
- AI summarizer with provider inference and local fallback (React route)

## API Routes

All backend routes are exposed under `/api`:

- OPTIONS `/api/<path>`
- GET `/api/health`
- GET `/api/ai-config`
- POST `/api/ai-summarize`
- POST `/api/cipher`
- POST `/api/cipher/intent` (intent classification via `meta-llama/llama-3.1-8b-instruct:free`)
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

## Environment Variables

Create `api/.env` with:

```env
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_legacy_jwt_service_role_key
```

Optional variables:

- `OPENROUTER_API_KEY`
- `AI_PROVIDER` (`openrouter`)
- `FLASK_SECRET_KEY` or `SESSION_SECRET` (strongly recommended for stable app sessions)
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
