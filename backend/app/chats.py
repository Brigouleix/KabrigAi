"""Conversations sauvegardées (SQLite)."""
import json
import sqlite3
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "kabrig.db"


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS chats ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "title TEXT NOT NULL,"
        "updated_at TEXT NOT NULL,"
        "messages TEXT NOT NULL)"
    )
    return conn


def list_chats() -> list[dict]:
    with _db() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT id, title, updated_at FROM chats ORDER BY updated_at DESC LIMIT 50"
        ).fetchall()
    return [dict(r) for r in rows]


def get_chat(chat_id: int) -> dict | None:
    with _db() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM chats WHERE id = ?", (chat_id,)).fetchone()
    if not row:
        return None
    out = dict(row)
    out["messages"] = json.loads(out["messages"])
    return out


def save_chat(chat_id: int | None, messages: list) -> dict:
    """Crée ou met à jour une conversation. Titre = début du premier message."""
    first_user = next((m for m in messages if m.get("role") == "user"), {})
    title = (first_user.get("content", "") or "Conversation")[:48]
    now = datetime.now().isoformat(timespec="seconds")
    blob = json.dumps(messages, ensure_ascii=False)
    with _db() as conn:
        if chat_id:
            cur = conn.execute(
                "UPDATE chats SET messages = ?, updated_at = ? WHERE id = ?",
                (blob, now, chat_id),
            )
            if cur.rowcount:
                return {"id": chat_id, "title": title}
        cur = conn.execute(
            "INSERT INTO chats (title, updated_at, messages) VALUES (?, ?, ?)",
            (title, now, blob),
        )
        return {"id": cur.lastrowid, "title": title}


def delete_chat(chat_id: int) -> None:
    with _db() as conn:
        conn.execute("DELETE FROM chats WHERE id = ?", (chat_id,))
