import sqlite3
import os
from datetime import datetime
from flask import Flask, jsonify, request, render_template, g

app = Flask(__name__)

DATABASE = os.path.join(os.path.dirname(__file__), 'subs_tracker.db')

CATEGORIES = ['動画', '音楽', 'AI', 'ゲーム', '仕事', 'クラウド', 'その他']

INITIAL_DATA = [
    {'name': 'Netflix',       'price': 1490, 'billing_cycle': 'MONTHLY', 'category': '動画'},
    {'name': 'Spotify',       'price': 980,  'billing_cycle': 'MONTHLY', 'category': '音楽'},
    {'name': 'ChatGPT Plus',  'price': 3000, 'billing_cycle': 'MONTHLY', 'category': 'AI'},
    {'name': 'Amazon Prime',  'price': 5900, 'billing_cycle': 'YEARLY',  'category': '動画'},
]


# ── DB helpers ──────────────────────────────────────────────────────────────

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    db.execute('''
        CREATE TABLE IF NOT EXISTS subscriptions (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT    NOT NULL,
            price        INTEGER NOT NULL,
            billing_cycle TEXT   NOT NULL,
            category     TEXT    NOT NULL,
            created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    db.commit()

    # Seed initial data only when the table is empty
    count = db.execute('SELECT COUNT(*) FROM subscriptions').fetchone()[0]
    if count == 0:
        now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
        for item in INITIAL_DATA:
            db.execute(
                'INSERT INTO subscriptions (name, price, billing_cycle, category, created_at, updated_at) '
                'VALUES (?, ?, ?, ?, ?, ?)',
                (item['name'], item['price'], item['billing_cycle'], item['category'], now, now)
            )
        db.commit()
    db.close()


# ── Pages ────────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


# ── API ──────────────────────────────────────────────────────────────────────

@app.route('/api/subscriptions', methods=['GET'])
def get_subscriptions():
    db = get_db()
    rows = db.execute(
        'SELECT * FROM subscriptions ORDER BY created_at DESC'
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/subscriptions', methods=['POST'])
def create_subscription():
    data = request.get_json()
    name          = data.get('name', '').strip()
    price         = data.get('price')
    billing_cycle = data.get('billing_cycle', '').upper()
    category      = data.get('category', '').strip()

    errors = _validate(name, price, billing_cycle, category)
    if errors:
        return jsonify({'errors': errors}), 400

    now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    db = get_db()
    cur = db.execute(
        'INSERT INTO subscriptions (name, price, billing_cycle, category, created_at, updated_at) '
        'VALUES (?, ?, ?, ?, ?, ?)',
        (name, int(price), billing_cycle, category, now, now)
    )
    db.commit()
    row = db.execute('SELECT * FROM subscriptions WHERE id = ?', (cur.lastrowid,)).fetchone()
    return jsonify(dict(row)), 201


@app.route('/api/subscriptions/<int:sub_id>', methods=['PUT'])
def update_subscription(sub_id):
    db = get_db()
    existing = db.execute('SELECT * FROM subscriptions WHERE id = ?', (sub_id,)).fetchone()
    if existing is None:
        return jsonify({'error': 'Not found'}), 404

    data = request.get_json()
    name          = data.get('name', '').strip()
    price         = data.get('price')
    billing_cycle = data.get('billing_cycle', '').upper()
    category      = data.get('category', '').strip()

    errors = _validate(name, price, billing_cycle, category)
    if errors:
        return jsonify({'errors': errors}), 400

    now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    db.execute(
        'UPDATE subscriptions SET name=?, price=?, billing_cycle=?, category=?, updated_at=? WHERE id=?',
        (name, int(price), billing_cycle, category, now, sub_id)
    )
    db.commit()
    row = db.execute('SELECT * FROM subscriptions WHERE id = ?', (sub_id,)).fetchone()
    return jsonify(dict(row))


@app.route('/api/subscriptions/<int:sub_id>', methods=['DELETE'])
def delete_subscription(sub_id):
    db = get_db()
    existing = db.execute('SELECT * FROM subscriptions WHERE id = ?', (sub_id,)).fetchone()
    if existing is None:
        return jsonify({'error': 'Not found'}), 404

    db.execute('DELETE FROM subscriptions WHERE id = ?', (sub_id,))
    db.commit()
    return '', 204


# ── Validation ───────────────────────────────────────────────────────────────

def _validate(name, price, billing_cycle, category):
    errors = []
    if not name:
        errors.append('サービス名は必須です。')
    if price is None:
        errors.append('料金は必須です。')
    else:
        try:
            p = int(price)
            if p <= 0:
                errors.append('料金は正の整数を入力してください。')
        except (ValueError, TypeError):
            errors.append('料金は正の整数を入力してください。')
    if billing_cycle not in ('MONTHLY', 'YEARLY'):
        errors.append('請求周期は MONTHLY または YEARLY を指定してください。')
    if category not in CATEGORIES:
        errors.append('カテゴリが不正です。')
    return errors


# ── Entry point ──────────────────────────────────────────────────────────────

if __name__ == '__main__':
    init_db()
    app.run(debug=True)
