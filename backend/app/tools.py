"""Tools de Kabrig : météo, notes, fichiers.

Chaque tool = définition (schéma JSON pour le LLM) + fonction d'exécution.
"""
import json
import sqlite3
from datetime import datetime
from pathlib import Path

import httpx

from .travel import TRAVEL_TOOL_DEFINITIONS, search_flights, search_hotels

DB_PATH = Path(__file__).parent.parent / "kabrig.db"
DOCS_DIR = Path.home() / "Documents"

WEATHER_CODES = {
    0: "ciel dégagé", 1: "plutôt dégagé", 2: "partiellement nuageux", 3: "couvert",
    45: "brouillard", 48: "brouillard givrant", 51: "bruine légère", 53: "bruine",
    55: "bruine dense", 61: "pluie légère", 63: "pluie", 65: "pluie forte",
    71: "neige légère", 73: "neige", 75: "neige forte", 80: "averses légères",
    81: "averses", 82: "averses violentes", 95: "orage", 96: "orage avec grêle",
}


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS notes ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "title TEXT NOT NULL,"
        "content TEXT NOT NULL,"
        "created_at TEXT NOT NULL)"
    )
    return conn


async def get_weather(city: str) -> tuple[str, dict]:
    """Retourne (texte pour le LLM, données structurées pour le widget UI)."""
    async with httpx.AsyncClient(timeout=10) as client:
        geo = await client.get(
            "https://geocoding-api.open-meteo.com/v1/search",
            params={"name": city, "count": 1, "language": "fr"},
        )
        results = geo.json().get("results")
        if not results:
            return f"Ville introuvable : {city}", {}
        loc = results[0]
        meteo = await client.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": loc["latitude"],
                "longitude": loc["longitude"],
                "current": "temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m",
                "daily": "temperature_2m_max,temperature_2m_min,weather_code",
                "forecast_days": 3,
                "timezone": "auto",
            },
        )
    data = meteo.json()
    cur = data["current"]
    days = data["daily"]
    lines = [
        f"Météo à {loc['name']} ({loc.get('country', '')}) :",
        f"Actuellement {cur['temperature_2m']}°C, "
        f"{WEATHER_CODES.get(cur['weather_code'], 'inconnu')}, "
        f"vent {cur['wind_speed_10m']} km/h, humidité {cur['relative_humidity_2m']}%",
    ]
    for i, date in enumerate(days["time"]):
        lines.append(
            f"{date} : {days['temperature_2m_min'][i]}–{days['temperature_2m_max'][i]}°C, "
            f"{WEATHER_CODES.get(days['weather_code'][i], '')}"
        )
    widget = {
        "city": loc["name"],
        "country": loc.get("country", ""),
        "temp": cur["temperature_2m"],
        "desc": WEATHER_CODES.get(cur["weather_code"], ""),
        "code": cur["weather_code"],
        "wind": cur["wind_speed_10m"],
        "humidity": cur["relative_humidity_2m"],
        "days": [
            {
                "date": days["time"][i],
                "min": days["temperature_2m_min"][i],
                "max": days["temperature_2m_max"][i],
                "code": days["weather_code"][i],
                "desc": WEATHER_CODES.get(days["weather_code"][i], ""),
            }
            for i in range(len(days["time"]))
        ],
    }
    return "\n".join(lines), widget


def create_note(title: str, content: str) -> str:
    with _db() as conn:
        conn.execute(
            "INSERT INTO notes (title, content, created_at) VALUES (?, ?, ?)",
            (title, content, datetime.now().isoformat(timespec="seconds")),
        )
    return f"Note « {title} » enregistrée."


def list_notes() -> str:
    with _db() as conn:
        rows = conn.execute(
            "SELECT id, title, created_at FROM notes ORDER BY id DESC"
        ).fetchall()
    if not rows:
        return "Aucune note."
    return "\n".join(f"[{r[0]}] {r[1]} ({r[2]})" for r in rows)


def read_note(note_id: int) -> str:
    with _db() as conn:
        row = conn.execute(
            "SELECT title, content FROM notes WHERE id = ?", (note_id,)
        ).fetchone()
    return f"# {row[0]}\n\n{row[1]}" if row else f"Note {note_id} introuvable."


def delete_note(note_id: int) -> str:
    with _db() as conn:
        cur = conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    return "Note supprimée." if cur.rowcount else f"Note {note_id} introuvable."


def list_documents(subfolder: str = "") -> str:
    target = (DOCS_DIR / subfolder).resolve()
    if not target.is_relative_to(DOCS_DIR) or not target.is_dir():
        return "Dossier introuvable (accès limité à Documents)."
    entries = sorted(target.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
    return "\n".join(
        f"{'📁' if e.is_dir() else '📄'} {e.name}" for e in entries[:100]
    ) or "Dossier vide."


def read_document(path: str) -> str:
    target = (DOCS_DIR / path).resolve()
    if not target.is_relative_to(DOCS_DIR) or not target.is_file():
        return "Fichier introuvable (accès limité à Documents)."
    if target.suffix.lower() not in {".txt", ".md", ".csv", ".json", ".log"}:
        return f"Format non supporté ({target.suffix}). Formats : txt, md, csv, json, log."
    text = target.read_text(encoding="utf-8", errors="replace")
    return text[:20000] + ("\n[... tronqué]" if len(text) > 20000 else "")


TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Météo actuelle et prévisions 3 jours pour une ville.",
            "parameters": {
                "type": "object",
                "properties": {"city": {"type": "string", "description": "Nom de la ville"}},
                "required": ["city"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_note",
            "description": "Enregistre une note persistante.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["title", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_notes",
            "description": "Liste toutes les notes enregistrées.",
            "parameters": {"type": "object", "properties": {}},
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
            "name": "delete_note",
            "description": "Supprime une note par son id.",
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
            "name": "list_documents",
            "description": "Liste les fichiers du dossier Documents de l'utilisateur.",
            "parameters": {
                "type": "object",
                "properties": {
                    "subfolder": {"type": "string", "description": "Sous-dossier optionnel"}
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_document",
            "description": "Lit un fichier texte du dossier Documents (txt, md, csv, json, log) pour le synthétiser.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string", "description": "Chemin relatif à Documents"}},
                "required": ["path"],
            },
        },
    },
] + TRAVEL_TOOL_DEFINITIONS


async def execute_tool(name: str, args: dict) -> tuple[str, dict | None]:
    """Retourne (texte pour le LLM, widget UI optionnel)."""
    try:
        if name == "get_weather":
            text, widget = await get_weather(**args)
            return text, {"widget": "weather", "data": widget} if widget else None
        if name == "search_flights":
            return await search_flights(**args)
        if name == "search_hotels":
            return await search_hotels(**args)
        sync = {
            "create_note": create_note,
            "list_notes": list_notes,
            "read_note": read_note,
            "delete_note": delete_note,
            "list_documents": list_documents,
            "read_document": read_document,
        }.get(name)
        if sync is None:
            return f"Tool inconnu : {name}", None
        return sync(**args), None
    except Exception as e:  # le LLM doit voir l'erreur pour réagir
        return f"Erreur du tool {name} : {e}", None
