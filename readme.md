# Focus Timer

This project is a Flask-based productivity app centered on a live timer screen.

## Features

- Live timer screen with current clock, elapsed time, and remaining time.
- Configurable session duration (minutes and seconds).
- Start and stop timer controls with automatic session completion at time limit.
- Session stats and history saved to SQLite.
- To-do manager, history view, calendar view, and AI summarizer pages.

## Tech Stack

- Backend: Flask
- Storage: SQLite
- Frontend: HTML, CSS, vanilla JavaScript

## Run Locally

1. Open a terminal in this project folder.
2. Install Flask (if needed):

```bash
pip install flask
```

3. Start the app:

```bash
python app.py
```

4. Open your browser and visit:

```text
http://127.0.0.1:5000/
```