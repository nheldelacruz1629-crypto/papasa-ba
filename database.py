<<<<<<< HEAD
import json
import os
import sqlite3
import uuid

DB_PATH = os.path.join(os.path.dirname(__file__), "pasadoba.db")

def _connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    with _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS subjects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                strategy TEXT NOT NULL DEFAULT 'raw',
                base_value REAL NOT NULL DEFAULT 0,
                target_grade REAL
            );
            CREATE TABLE IF NOT EXISTS assessments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subject_id TEXT NOT NULL,
                name TEXT NOT NULL,
                weight REAL,
                UNIQUE(subject_id, name),
                FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS scores (
                id TEXT PRIMARY KEY,
                assessment_id INTEGER NOT NULL,
                name TEXT,
                score REAL NOT NULL,
                max_score REAL NOT NULL,
                percentage REAL NOT NULL,
                FOREIGN KEY(assessment_id) REFERENCES assessments(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS ui_subjects (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL
            );
            """
        )

def _row_to_subject(conn, row):
    assessments = {}
    weights = {}
    assessment_rows = conn.execute(
        "SELECT id, name, weight FROM assessments WHERE subject_id = ?",
        (row["id"],)
    ).fetchall()
    for assessment_row in assessment_rows:
        score_rows = conn.execute(
            "SELECT id, name, score, max_score, percentage "
            "FROM scores WHERE assessment_id = ? ORDER BY rowid",
            (assessment_row["id"],)
        ).fetchall()
        items = [
            {
                "id": score["id"],
                "name": score["name"],
                "score": score["score"],
                "maxScore": score["max_score"],
                "percentage": score["percentage"]
            }
            for score in score_rows
        ]
        average = round(sum(i["percentage"] for i in items) / len(items), 2) if items else 0
        assessments[assessment_row["name"]] = {
            "name": assessment_row["name"],
            "average": average,
            "items": items
        }
        if assessment_row["weight"] is not None:
            weights[assessment_row["name"]] = assessment_row["weight"]
    return {
        "id": row["id"],
        "name": row["name"],
        "strategy": row["strategy"],
        "base_value": row["base_value"],
        "target_grade": row["target_grade"],
        "weights": weights,
        "assessments": assessments
    }

def list_subjects():
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, name, strategy, base_value, target_grade "
            "FROM subjects ORDER BY name COLLATE NOCASE"
        ).fetchall()
        return [_row_to_subject(conn, row) for row in rows]

def get_subject(subject_id):
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, name, strategy, base_value, target_grade "
            "FROM subjects WHERE id = ?",
            (subject_id,)
        ).fetchone()
        if not row:
            return None
        return _row_to_subject(conn, row)

def subject_exists(subject_id):
    with _connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM subjects WHERE id = ?",
            (subject_id,)
        ).fetchone()
        return row is not None

def subject_name_exists(name):
    with _connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM subjects WHERE lower(name) = lower(?)",
            (name,)
        ).fetchone()
        return row is not None

def create_subject(name, strategy, base_value, target_grade):
    subject_id = str(uuid.uuid4())[:8]
    base_value = base_value if base_value is not None else 0
    with _connect() as conn:
        conn.execute(
            "INSERT INTO subjects (id, name, strategy, base_value, target_grade) "
            "VALUES (?, ?, ?, ?, ?)",
            (subject_id, name, strategy or 'raw', base_value, target_grade)
        )
    return subject_id

def update_subject(subject_id, data):
    fields = {}
    if 'name' in data:
        fields['name'] = data['name']
    if 'target_grade' in data:
        fields['target_grade'] = data['target_grade']
    if 'strategy' in data:
        fields['strategy'] = data['strategy']
    if 'base_value' in data:
        base_value = data['base_value']
        fields['base_value'] = base_value if base_value is not None else 0
    if not fields:
        return
    assignments = ", ".join(f"{key} = ?" for key in fields)
    values = list(fields.values()) + [subject_id]
    with _connect() as conn:
        conn.execute(
            f"UPDATE subjects SET {assignments} WHERE id = ?",
            values
        )

def delete_subject(subject_id):
    with _connect() as conn:
        conn.execute(
            "DELETE FROM subjects WHERE id = ?",
            (subject_id,)
        )

def assessment_exists(subject_id, name):
    with _connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM assessments WHERE subject_id = ? AND name = ?",
            (subject_id, name)
        ).fetchone()
        return row is not None

def get_assessment_names(subject_id):
    with _connect() as conn:
        rows = conn.execute(
            "SELECT name FROM assessments WHERE subject_id = ?",
            (subject_id,)
        ).fetchall()
        return [row["name"] for row in rows]

def add_assessment(subject_id, name, weight):
    with _connect() as conn:
        conn.execute(
            "INSERT INTO assessments (subject_id, name, weight) VALUES (?, ?, ?)",
            (subject_id, name, weight)
        )

def delete_assessment(subject_id, name):
    with _connect() as conn:
        conn.execute(
            "DELETE FROM assessments WHERE subject_id = ? AND name = ?",
            (subject_id, name)
        )

def set_weights(subject_id, weights):
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, name FROM assessments WHERE subject_id = ?",
            (subject_id,)
        ).fetchall()
        for row in rows:
            weight = weights.get(row["name"], 0)
            conn.execute(
                "UPDATE assessments SET weight = ? WHERE id = ?",
                (weight, row["id"])
            )

def add_score(subject_id, assessment_name, score_id, item_name, score, max_score, percentage):
    with _connect() as conn:
        assessment_row = conn.execute(
            "SELECT id FROM assessments WHERE subject_id = ? AND name = ?",
            (subject_id, assessment_name)
        ).fetchone()
        if not assessment_row:
            return False
        conn.execute(
            "INSERT INTO scores (id, assessment_id, name, score, max_score, percentage) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (score_id, assessment_row["id"], item_name, score, max_score, percentage)
        )
    return True

def delete_score(subject_id, score_id):
    with _connect() as conn:
        row = conn.execute(
            "SELECT s.id FROM scores s "
            "JOIN assessments a ON s.assessment_id = a.id "
            "WHERE s.id = ? AND a.subject_id = ?",
            (score_id, subject_id)
        ).fetchone()
        if not row:
            return False
        conn.execute(
            "DELETE FROM scores WHERE id = ?",
            (score_id,)
        )
        return True

def list_ui_subjects():
    with _connect() as conn:
        rows = conn.execute(
            "SELECT data FROM ui_subjects"
        ).fetchall()
        return [json.loads(row["data"]) for row in rows]

def ui_subject_exists(subject_id):
    with _connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM ui_subjects WHERE id = ?",
            (subject_id,)
        ).fetchone()
        return row is not None

def create_ui_subject(subject_id, subject):
    with _connect() as conn:
        conn.execute(
            "INSERT INTO ui_subjects (id, data) VALUES (?, ?)",
            (subject_id, json.dumps(subject))
        )

def update_ui_subject(subject_id, subject):
    with _connect() as conn:
        conn.execute(
            "UPDATE ui_subjects SET data = ? WHERE id = ?",
            (json.dumps(subject), subject_id)
        )

def delete_ui_subject(subject_id):
    with _connect() as conn:
        conn.execute(
            "DELETE FROM ui_subjects WHERE id = ?",
            (subject_id,)
        )
=======
import json
import os
import sqlite3
import uuid

DB_PATH = os.path.join(os.path.dirname(__file__), "pasadoba.db")

def _connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    with _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS subjects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                strategy TEXT NOT NULL DEFAULT 'raw',
                base_value REAL NOT NULL DEFAULT 0,
                target_grade REAL
            );
            CREATE TABLE IF NOT EXISTS assessments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subject_id TEXT NOT NULL,
                name TEXT NOT NULL,
                weight REAL,
                UNIQUE(subject_id, name),
                FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS scores (
                id TEXT PRIMARY KEY,
                assessment_id INTEGER NOT NULL,
                name TEXT,
                score REAL NOT NULL,
                max_score REAL NOT NULL,
                percentage REAL NOT NULL,
                FOREIGN KEY(assessment_id) REFERENCES assessments(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS ui_subjects (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL
            );
            """
        )

def _row_to_subject(conn, row):
    assessments = {}
    weights = {}
    assessment_rows = conn.execute(
        "SELECT id, name, weight FROM assessments WHERE subject_id = ?",
        (row["id"],)
    ).fetchall()
    for assessment_row in assessment_rows:
        score_rows = conn.execute(
            "SELECT id, name, score, max_score, percentage "
            "FROM scores WHERE assessment_id = ? ORDER BY rowid",
            (assessment_row["id"],)
        ).fetchall()
        items = [
            {
                "id": score["id"],
                "name": score["name"],
                "score": score["score"],
                "maxScore": score["max_score"],
                "percentage": score["percentage"]
            }
            for score in score_rows
        ]
        average = round(sum(i["percentage"] for i in items) / len(items), 2) if items else 0
        assessments[assessment_row["name"]] = {
            "name": assessment_row["name"],
            "average": average,
            "items": items
        }
        if assessment_row["weight"] is not None:
            weights[assessment_row["name"]] = assessment_row["weight"]
    return {
        "id": row["id"],
        "name": row["name"],
        "strategy": row["strategy"],
        "base_value": row["base_value"],
        "target_grade": row["target_grade"],
        "weights": weights,
        "assessments": assessments
    }

def list_subjects():
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, name, strategy, base_value, target_grade "
            "FROM subjects ORDER BY name COLLATE NOCASE"
        ).fetchall()
        return [_row_to_subject(conn, row) for row in rows]

def get_subject(subject_id):
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, name, strategy, base_value, target_grade "
            "FROM subjects WHERE id = ?",
            (subject_id,)
        ).fetchone()
        if not row:
            return None
        return _row_to_subject(conn, row)

def subject_exists(subject_id):
    with _connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM subjects WHERE id = ?",
            (subject_id,)
        ).fetchone()
        return row is not None

def subject_name_exists(name):
    with _connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM subjects WHERE lower(name) = lower(?)",
            (name,)
        ).fetchone()
        return row is not None

def create_subject(name, strategy, base_value, target_grade):
    subject_id = str(uuid.uuid4())[:8]
    base_value = base_value if base_value is not None else 0
    with _connect() as conn:
        conn.execute(
            "INSERT INTO subjects (id, name, strategy, base_value, target_grade) "
            "VALUES (?, ?, ?, ?, ?)",
            (subject_id, name, strategy or 'raw', base_value, target_grade)
        )
    return subject_id

def update_subject(subject_id, data):
    fields = {}
    if 'name' in data:
        fields['name'] = data['name']
    if 'target_grade' in data:
        fields['target_grade'] = data['target_grade']
    if 'strategy' in data:
        fields['strategy'] = data['strategy']
    if 'base_value' in data:
        base_value = data['base_value']
        fields['base_value'] = base_value if base_value is not None else 0
    if not fields:
        return
    assignments = ", ".join(f"{key} = ?" for key in fields)
    values = list(fields.values()) + [subject_id]
    with _connect() as conn:
        conn.execute(
            f"UPDATE subjects SET {assignments} WHERE id = ?",
            values
        )

def delete_subject(subject_id):
    with _connect() as conn:
        conn.execute(
            "DELETE FROM subjects WHERE id = ?",
            (subject_id,)
        )

def assessment_exists(subject_id, name):
    with _connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM assessments WHERE subject_id = ? AND name = ?",
            (subject_id, name)
        ).fetchone()
        return row is not None

def get_assessment_names(subject_id):
    with _connect() as conn:
        rows = conn.execute(
            "SELECT name FROM assessments WHERE subject_id = ?",
            (subject_id,)
        ).fetchall()
        return [row["name"] for row in rows]

def add_assessment(subject_id, name, weight):
    with _connect() as conn:
        conn.execute(
            "INSERT INTO assessments (subject_id, name, weight) VALUES (?, ?, ?)",
            (subject_id, name, weight)
        )

def delete_assessment(subject_id, name):
    with _connect() as conn:
        conn.execute(
            "DELETE FROM assessments WHERE subject_id = ? AND name = ?",
            (subject_id, name)
        )

def set_weights(subject_id, weights):
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, name FROM assessments WHERE subject_id = ?",
            (subject_id,)
        ).fetchall()
        for row in rows:
            weight = weights.get(row["name"], 0)
            conn.execute(
                "UPDATE assessments SET weight = ? WHERE id = ?",
                (weight, row["id"])
            )

def add_score(subject_id, assessment_name, score_id, item_name, score, max_score, percentage):
    with _connect() as conn:
        assessment_row = conn.execute(
            "SELECT id FROM assessments WHERE subject_id = ? AND name = ?",
            (subject_id, assessment_name)
        ).fetchone()
        if not assessment_row:
            return False
        conn.execute(
            "INSERT INTO scores (id, assessment_id, name, score, max_score, percentage) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (score_id, assessment_row["id"], item_name, score, max_score, percentage)
        )
    return True

def delete_score(subject_id, score_id):
    with _connect() as conn:
        row = conn.execute(
            "SELECT s.id FROM scores s "
            "JOIN assessments a ON s.assessment_id = a.id "
            "WHERE s.id = ? AND a.subject_id = ?",
            (score_id, subject_id)
        ).fetchone()
        if not row:
            return False
        conn.execute(
            "DELETE FROM scores WHERE id = ?",
            (score_id,)
        )
        return True

def list_ui_subjects():
    with _connect() as conn:
        rows = conn.execute(
            "SELECT data FROM ui_subjects"
        ).fetchall()
        return [json.loads(row["data"]) for row in rows]

def ui_subject_exists(subject_id):
    with _connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM ui_subjects WHERE id = ?",
            (subject_id,)
        ).fetchone()
        return row is not None

def create_ui_subject(subject_id, subject):
    with _connect() as conn:
        conn.execute(
            "INSERT INTO ui_subjects (id, data) VALUES (?, ?)",
            (subject_id, json.dumps(subject))
        )

def update_ui_subject(subject_id, subject):
    with _connect() as conn:
        conn.execute(
            "UPDATE ui_subjects SET data = ? WHERE id = ?",
            (json.dumps(subject), subject_id)
        )

def delete_ui_subject(subject_id):
    with _connect() as conn:
        conn.execute(
            "DELETE FROM ui_subjects WHERE id = ?",
            (subject_id,)
        )
>>>>>>> 90632e0b5e3a6c78717e56d883c4bb10c9025207
