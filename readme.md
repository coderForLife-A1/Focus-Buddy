# FocusBuddy

FocusBuddy is a productivity web app built for Azure Static Web Apps.

The project is split into:
- frontend: static HTML, CSS, and JavaScript pages
- api: serverless Python backend using Azure Functions

## Project Structure

```
FocusBuddy/
├── frontend/
│   ├── index.html
│   ├── todo.html
│   ├── history.html
│   ├── calendar.html
│   ├── ai_summarizer.html
│   ├── interactive-bg.css
│   └── interactive-bg.js
├── api/
│   ├── focus_api/
│   │   ├── __init__.py
│   │   └── function.json
│   ├── host.json
│   ├── requirements.txt
│   ├── ai_config.py
│   ├── ai_config_local.py
│   └── database.db
├── .gitignore
├── LICENSE
└── readme.md
```

## Features

- Live timer screen with session tracking
- Focus history and summary analytics
- To-do manager with due dates
- Calendar view with holiday overlays
- AI summarizer with provider auto-detection and local fallback

## Backend API Routes

All routes are served from Azure Functions under the /api prefix:

- GET /api/ai-config
- POST /api/ai-summarize
- GET /api/focus-sessions
- POST /api/focus-sessions
- DELETE /api/focus-sessions
- GET /api/todos
- POST /api/todos
- PATCH /api/todos/{id}
- DELETE /api/todos/{id}

## Local Development

Prerequisites:
- Python 3.10+
- Azure Functions Core Tools v4

1. Install backend dependencies:

```bash
cd api
pip install -r requirements.txt
```

2. Run the Azure Function API locally:

```bash
func start
```

3. Serve frontend files from the frontend folder (for example):

```bash
cd ../frontend
python -m http.server 5500
```

4. Open the frontend:

```text
http://localhost:5500/index.html
```

The frontend calls the API at /api/* when hosted in Azure Static Web Apps.
