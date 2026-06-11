"""Agenda local : événements en SQLite, accessibles au LLM et à l'UI."""
import sqlite3
from datetime import date
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "kabrig.db"


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS events ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "title TEXT NOT NULL,"
        "date TEXT NOT NULL,"
        "time TEXT DEFAULT '',"
        "location TEXT DEFAULT '',"
        "notes TEXT DEFAULT '')"
    )
    return conn


def create_event(title: str, date: str, time: str = "", location: str = "", notes: str = "") -> str:
    with _db() as conn:
        conn.execute(
            "INSERT INTO events (title, date, time, location, notes) VALUES (?, ?, ?, ?, ?)",
            (title, date, time, location, notes),
        )
    when = f"{date} {time}".strip()
    return f"Événement « {title} » ajouté à l'agenda le {when}."


def list_events(include_past: bool = False) -> str:
    rows = get_events(include_past)
    if not rows:
        return "Aucun événement à venir."
    return "\n".join(
        f"[{e['id']}] {e['date']} {e['time']} — {e['title']}"
        + (f" ({e['location']})" if e["location"] else "")
        for e in rows
    )


def get_events(include_past: bool = False, limit: int = 50) -> list[dict]:
    with _db() as conn:
        conn.row_factory = sqlite3.Row
        if include_past:
            rows = conn.execute("SELECT * FROM events ORDER BY date, time LIMIT ?", (limit,))
        else:
            rows = conn.execute(
                "SELECT * FROM events WHERE date >= ? ORDER BY date, time LIMIT ?",
                (date.today().isoformat(), limit),
            )
        return [dict(r) for r in rows.fetchall()]


def delete_event(event_id: int) -> str:
    with _db() as conn:
        cur = conn.execute("DELETE FROM events WHERE id = ?", (event_id,))
    return "Événement supprimé." if cur.rowcount else f"Événement {event_id} introuvable."


AGENDA_TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "create_event",
            "description": "Ajoute un événement à l'agenda d'Antoine.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "date": {"type": "string", "description": "YYYY-MM-DD"},
                    "time": {"type": "string", "description": "HH:MM, optionnel"},
                    "location": {"type": "string", "description": "Optionnel"},
                    "notes": {"type": "string", "description": "Optionnel"},
                },
                "required": ["title", "date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_events",
            "description": "Liste les événements à venir de l'agenda.",
            "parameters": {
                "type": "object",
                "properties": {
                    "include_past": {"type": "boolean", "description": "Inclure le passé, défaut false"}
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_event",
            "description": "Supprime un événement de l'agenda par son id.",
            "parameters": {
                "type": "object",
                "properties": {"event_id": {"type": "integer"}},
                "required": ["event_id"],
            },
        },
    },
]
