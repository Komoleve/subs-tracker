import sqlite3
import os
import csv
import io
from datetime import datetime
from flask import Flask, jsonify, request, render_template, g, Response

app = Flask(__name__)

DATABASE = os.path.join(os.path.dirname(__file__), 'subs_tracker.db')

CATEGORIES = ['動画', '音楽', 'AI', 'ゲーム', '仕事', 'クラウド', 'その他']
STATUSES   = ['ACTIVE', 'PAUSED', 'CANCELED']

INITIAL_DATA = [
    {'name': 'Netflix',      'price': 1490, 'billing_cycle': 'MONTHLY', 'category': '動画'},
    {'name': 'Spotify',      'price': 980,  'billing_cycle': 'MONTHLY', 'category': '音楽'},
    {'name': 'ChatGPT Plus', 'price': 3000, 'billing_cycle': 'MONTHLY', 'category': 'AI'},
    {'name': 'Amazon Prime', 'price': 5900, 'billing_cycle': 'YEARLY',  'category': '動画'},
]

CSV_FIELDS = [
    'name', 'price', 'billing_cycle', 'category',
    'payment_day', 'start_date', 'renewal_date', 'status',
    'created_at', 'updated_at',
]
CSV_HEADERS = [
    'サービス名', '料金', '請求周期', 'カテゴリ',
    '支払日', '契約開始日', '更新日', 'ステータス',
    '作成日時', '更新日時',
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

    # Create table with all columns
    db.execute('''
        CREATE TABLE IF NOT EXISTS subscriptions (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT    NOT NULL,
            price         INTEGER NOT NULL,
            billing_cycle TEXT    NOT NULL,
            category      TEXT    NOT NULL,
            payment_day   INTEGER,
            start_date    DATE,
            renewal_date  DATE,
            status        TEXT    NOT NULL DEFAULT 'ACTIVE',
            created_at    DATETIME NOT NULL,
            updated_at    DATETIME NOT NULL
        )
    ''')
    db.commit()

    # Migration: add new columns if they don't exist yet
    existing_cols = {row[1] for row in db.execute("PRAGMA table_info(subscriptions)").fetchall()}
    migrations = [
        ('payment_day',  'ALTER TABLE subscriptions ADD COLUMN payment_day  INTEGER'),
        ('start_date',   'ALTER TABLE subscriptions ADD COLUMN start_date   DATE'),
        ('renewal_date', 'ALTER TABLE subscriptions ADD COLUMN renewal_date DATE'),
        ('status',       "ALTER TABLE subscriptions ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'"),
    ]
    for col, sql in migrations:
        if col not in existing_cols:
            db.execute(sql)
    db.commit()

    # Seed initial data only when the table is empty
    count = db.execute('SELECT COUNT(*) FROM subscriptions').fetchone()[0]
    if count == 0:
        now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
        for item in INITIAL_DATA:
            db.execute(
                'INSERT INTO subscriptions '
                '(name, price, billing_cycle, category, status, created_at, updated_at) '
                'VALUES (?, ?, ?, ?, ?, ?, ?)',
                (item['name'], item['price'], item['billing_cycle'],
                 item['category'], 'ACTIVE', now, now)
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
    payment_day   = data.get('payment_day') or None
    start_date    = data.get('start_date') or None
    renewal_date  = data.get('renewal_date') or None
    status        = data.get('status', 'ACTIVE').upper()

    errors = _validate(name, price, billing_cycle, category, payment_day, status)
    if errors:
        return jsonify({'errors': errors}), 400

    now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    db = get_db()
    cur = db.execute(
        'INSERT INTO subscriptions '
        '(name, price, billing_cycle, category, payment_day, start_date, renewal_date, status, created_at, updated_at) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (name, int(price), billing_cycle, category,
         int(payment_day) if payment_day is not None else None,
         start_date, renewal_date, status, now, now)
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
    payment_day   = data.get('payment_day') or None
    start_date    = data.get('start_date') or None
    renewal_date  = data.get('renewal_date') or None
    status        = data.get('status', 'ACTIVE').upper()

    errors = _validate(name, price, billing_cycle, category, payment_day, status)
    if errors:
        return jsonify({'errors': errors}), 400

    now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    db.execute(
        'UPDATE subscriptions SET name=?, price=?, billing_cycle=?, category=?, '
        'payment_day=?, start_date=?, renewal_date=?, status=?, updated_at=? WHERE id=?',
        (name, int(price), billing_cycle, category,
         int(payment_day) if payment_day is not None else None,
         start_date, renewal_date, status, now, sub_id)
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


# ── CSV Export ────────────────────────────────────────────────────────────────

@app.route('/api/subscriptions/export', methods=['GET'])
def export_csv():
    db = get_db()
    rows = db.execute('SELECT * FROM subscriptions ORDER BY created_at DESC').fetchall()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(CSV_HEADERS)
    for row in rows:
        r = dict(row)
        writer.writerow([r.get(f, '') or '' for f in CSV_FIELDS])

    output.seek(0)
    return Response(
        '\ufeff' + output.getvalue(),   # BOM for Excel
        mimetype='text/csv',
        headers={'Content-Disposition': 'attachment; filename=subscriptions.csv'}
    )


# ── CSV Import ────────────────────────────────────────────────────────────────

@app.route('/api/subscriptions/import', methods=['POST'])
def import_csv():
    if 'file' not in request.files:
        return jsonify({'error': 'ファイルが見つかりません。'}), 400

    file = request.files['file']
    if not file.filename.endswith('.csv'):
        return jsonify({'error': 'CSVファイルを選択してください。'}), 400

    content = file.read().decode('utf-8-sig')   # handle BOM
    reader  = csv.DictReader(io.StringIO(content))

    # Accept both Japanese and English header names
    HEADER_MAP = {
        'サービス名': 'name',      'name': 'name',
        '料金':       'price',     'price': 'price',
        '請求周期':   'billing_cycle', 'billing_cycle': 'billing_cycle',
        'カテゴリ':   'category',  'category': 'category',
        '支払日':     'payment_day', 'payment_day': 'payment_day',
        '契約開始日': 'start_date', 'start_date': 'start_date',
        '更新日':     'renewal_date', 'renewal_date': 'renewal_date',
        'ステータス': 'status',    'status': 'status',
    }
    CYCLE_MAP = {'月額': 'MONTHLY', 'MONTHLY': 'MONTHLY', '年額': 'YEARLY', 'YEARLY': 'YEARLY'}
    STATUS_MAP = {'利用中': 'ACTIVE', 'ACTIVE': 'ACTIVE',
                  '停止中': 'PAUSED', 'PAUSED': 'PAUSED',
                  '解約済み': 'CANCELED', 'CANCELED': 'CANCELED'}

    db  = get_db()
    now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    imported = 0
    row_errors = []

    for i, row in enumerate(reader, start=2):
        mapped = {HEADER_MAP[k]: v for k, v in row.items() if k in HEADER_MAP}

        name          = (mapped.get('name') or '').strip()
        price_raw     = mapped.get('price')
        billing_raw   = (mapped.get('billing_cycle') or '').strip()
        category      = (mapped.get('category') or '').strip()
        payment_day   = mapped.get('payment_day') or None
        start_date    = mapped.get('start_date') or None
        renewal_date  = mapped.get('renewal_date') or None
        status_raw    = (mapped.get('status') or 'ACTIVE').strip()

        billing_cycle = CYCLE_MAP.get(billing_raw, billing_raw.upper())
        status        = STATUS_MAP.get(status_raw, 'ACTIVE')

        errs = _validate(name, price_raw, billing_cycle, category, payment_day, status)
        if errs:
            row_errors.append({'row': i, 'errors': errs})
            continue

        db.execute(
            'INSERT INTO subscriptions '
            '(name, price, billing_cycle, category, payment_day, start_date, renewal_date, status, created_at, updated_at) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (name, int(price_raw), billing_cycle, category,
             int(payment_day) if payment_day else None,
             start_date or None, renewal_date or None, status, now, now)
        )
        imported += 1

    db.commit()
    return jsonify({'imported': imported, 'errors': row_errors}), 200


# ── Validation ───────────────────────────────────────────────────────────────

def _validate(name, price, billing_cycle, category, payment_day=None, status='ACTIVE'):
    errors = []
    if not name:
        errors.append('サービス名は必須です。')
    if price is None or price == '':
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
    if payment_day is not None and payment_day != '':
        try:
            d = int(payment_day)
            if not (1 <= d <= 31):
                errors.append('支払日は1〜31の整数を入力してください。')
        except (ValueError, TypeError):
            errors.append('支払日は1〜31の整数を入力してください。')
    if status not in STATUSES:
        errors.append('ステータスが不正です。')
    return errors


# ── Entry point ──────────────────────────────────────────────────────────────

if __name__ == '__main__':
    init_db()
    app.run(debug=True)
