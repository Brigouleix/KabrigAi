"""Notes avec organisation en sous-dossiers (SQLite).

Accessible à l'UI (tuile + REST) et au LLM (tools). Le "dossier" est un simple
chemin texte ("Perso/Idées"), ce qui permet une arbo sans table séparée.
"""
import sqlite3
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "kabrig.db"


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS notes ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "title TEXT NOT NULL,"
        "content TEXT NOT NULL,"
        "created_at TEXT NOT NULL)"
    )
    # Migration : ajoute la colonne folder si elle n'existe pas encore.
    cols = [r[1] for r in conn.execute("PRAGMA table_info(notes)").fetchall()]
    if "folder" not in cols:
        conn.execute("ALTER TABLE notes ADD COLUMN folder TEXT DEFAULT ''")
    if "updated_at" not in cols:
        conn.execute("ALTER TABLE notes ADD COLUMN updated_at TEXT DEFAULT ''")
    return conn


def _clean_folder(folder: str) -> str:
    parts = [p.strip() for p in (folder or "").replace("\\", "/").split("/") if p.strip()]
    return "/".join(parts)


def get_notes() -> list[dict]:
    with _db() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT id, title, content, folder, created_at, updated_at "
            "FROM notes ORDER BY folder, id DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def list_folders() -> list[str]:
    with _db() as conn:
        rows = conn.execute(
            "SELECT DISTINCT folder FROM notes WHERE folder != '' ORDER BY folder"
        ).fetchall()
    return [r[0] for r in rows]


def create_note(title: str = "", content: str = "", folder: str = "") -> str:
    # Repli : si le modèle oublie le titre, on le déduit du contenu.
    title = (title or "").strip()
    if not title:
        first = (content or "").strip().splitlines()[0] if content.strip() else ""
        title = (first[:40] or "Note")
    now = datetime.now().isoformat(timespec="seconds")
    with _db() as conn:
        conn.execute(
            "INSERT INTO notes (title, content, folder, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (title.strip(), content, _clean_folder(folder), now, now),
        )
    where = f" dans « {_clean_folder(folder)} »" if folder else ""
    return f"Note « {title} » créée{where}."


def update_note(note_id: int, title: str = "", content: str | None = None,
                folder: str | None = None) -> str:
    sets, params = [], []
    if title:
        sets.append("title = ?"); params.append(title.strip())
    if content is not None:
        sets.append("content = ?"); params.append(content)
    if folder is not None:
        sets.append("folder = ?"); params.append(_clean_folder(folder))
    if not sets:
        return "Rien à modifier."
    sets.append("updated_at = ?"); params.append(datetime.now().isoformat(timespec="seconds"))
    params.append(note_id)
    with _db() as conn:
        cur = conn.execute(f"UPDATE notes SET {', '.join(sets)} WHERE id = ?", params)
    return "Note mise à jour." if cur.rowcount else f"Note {note_id} introuvable."


def read_note(note_id: int) -> str:
    with _db() as conn:
        row = conn.execute(
            "SELECT title, content, folder FROM notes WHERE id = ?", (note_id,)
        ).fetchone()
    if not row:
        return f"Note {note_id} introuvable."
    header = f"# {row[0]}" + (f"  ({row[2]})" if row[2] else "")
    return f"{header}\n\n{row[1]}"


def list_notes(folder: str = "") -> str:
    notes = get_notes()
    if folder:
        f = _clean_folder(folder)
        notes = [n for n in notes if n["folder"] == f or n["folder"].startswith(f + "/")]
    if not notes:
        return "Aucune note." if not folder else f"Aucune note dans « {folder} »."
    return "\n".join(
        f"[{n['id']}] {n['title']}" + (f"  ({n['folder']})" if n["folder"] else "")
        for n in notes
    )


def delete_note(note_id: int) -> str:
    with _db() as conn:
        cur = conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    return "Note supprimée." if cur.rowcount else f"Note {note_id} introuvable."


NOTES_TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "create_note",
            "description": "Crée une note. Peut être rangée dans un sous-dossier (ex: 'Perso/Idées').",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "content": {"type": "string", "description": "Contenu de la note (markdown ok)"},
                    "folder": {"type": "string", "description": "Dossier optionnel, ex: Travail/Réunions"},
                },
                "required": ["title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_notes",
            "description": "Liste les notes, éventuellement filtrées par dossier.",
            "parameters": {
                "type": "object",
                "properties": {"folder": {"type": "string", "description": "Dossier optionnel"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_note",
            "description": "Lit le contenu d'une note par son id.",
            "parameters": {
                "type": "object",
                "properties": {"note_id": {"type": "integer"}},
                "required": ["note_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_note",
            "description": "Modifie une note (titre, contenu, ou la déplace dans un autre dossier).",
            "parameters": {
                "type": "object",
                "properties": {
                    "note_id": {"type": "integer"},
                    "title": {"type": "string"},
                    "content": {"type": "string"},
                    "folder": {"type": "string", "description": "Nouveau dossier"},
                },
                "required": ["note_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_note",
            "description": "Supprime une note par son id.",
            "parameters": {
                "type": "object",
                "properties": {"note_id": {"type": "integer"}},
                "required": ["note_id"],
            },
        },
    },
]
