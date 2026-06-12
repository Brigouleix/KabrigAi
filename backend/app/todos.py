"""Todo list : SQLite, accessible à l'UI (tuile accueil) et au LLM (tools)."""
import sqlite3
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "kabrig.db"


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS todos ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "text TEXT NOT NULL,"
        "done INTEGER DEFAULT 0,"
        "created_at TEXT NOT NULL)"
    )
    return conn


def get_todos() -> list[dict]:
    with _db() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM todos ORDER BY done, id DESC LIMIT 100"
        ).fetchall()
    return [dict(r) for r in rows]


def add_todo(text: str) -> str:
    with _db() as conn:
        conn.execute(
            "INSERT INTO todos (text, created_at) VALUES (?, ?)",
            (text.strip(), datetime.now().isoformat(timespec="seconds")),
        )
    return f"Ajouté à la todo : « {text.strip()} »"


def toggle_todo(todo_id: int) -> str:
    with _db() as conn:
        cur = conn.execute("UPDATE todos SET done = 1 - done WHERE id = ?", (todo_id,))
    return "Tâche mise à jour." if cur.rowcount else f"Tâche {todo_id} introuvable."


def complete_todo(text_or_id: str) -> str:
    """Coche une tâche par id ou par texte approchant."""
    with _db() as conn:
        if text_or_id.isdigit():
            cur = conn.execute("UPDATE todos SET done = 1 WHERE id = ?", (int(text_or_id),))
        else:
            cur = conn.execute(
                "UPDATE todos SET done = 1 WHERE done = 0 AND text LIKE ?",
                (f"%{text_or_id.strip()}%",),
            )
    return f"{cur.rowcount} tâche(s) cochée(s)." if cur.rowcount else "Aucune tâche correspondante."


def delete_todo(todo_id: int) -> str:
    with _db() as conn:
        cur = conn.execute("DELETE FROM todos WHERE id = ?", (todo_id,))
    return "Tâche supprimée." if cur.rowcount else f"Tâche {todo_id} introuvable."


def clear_done() -> str:
    with _db() as conn:
        cur = conn.execute("DELETE FROM todos WHERE done = 1")
    return f"{cur.rowcount} tâche(s) terminée(s) supprimée(s)."


def list_todos() -> str:
    todos = get_todos()
    if not todos:
        return "La todo list est vide."
    return "\n".join(
        f"[{t['id']}] {'✅' if t['done'] else '⬜'} {t['text']}" for t in todos
    )


TODO_TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "add_todo",
            "description": "Ajoute une tâche à la todo list (visible sur l'accueil).",
            "parameters": {
                "type": "object",
                "properties": {"text": {"type": "string", "description": "La tâche"}},
                "required": ["text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_todos",
            "description": "Liste les tâches de la todo list.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "complete_todo",
            "description": "Coche une tâche comme faite, par son id ou un bout de son texte.",
            "parameters": {
                "type": "object",
                "properties": {
                    "text_or_id": {"type": "string", "description": "Id ou texte approchant"}
                },
                "required": ["text_or_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_todo",
            "description": "Supprime une tâche de la todo par son id.",
            "parameters": {
                "type": "object",
                "properties": {"todo_id": {"type": "integer"}},
                "required": ["todo_id"],
            },
        },
    },
]
