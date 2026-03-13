from flask import Flask, request, render_template
import sqlite3

app = Flask(__name__)

# Ensure database and table exist
def init_db():
    conn = sqlite3.connect('database.db')
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            email TEXT
        )
    ''')
    conn.commit()
    conn.close()

init_db()

@app.route('/', methods=['GET', 'POST'])
def index():
    if request.method == 'POST':
        name = request.form.get('name')
        email = request.form.get('email')
        conn = sqlite3.connect('database.db')
        c = conn.cursor()
        c.execute('INSERT INTO data (name, email) VALUES (?, ?)', (name, email))
        conn.commit()
        conn.close()
        return 'Data saved!'
    return render_template('index.html')

if __name__ == '__main__':
    app.run(debug=True)