"""Tools de Kabrig : météo, notes, fichiers.

Chaque tool = définition (schéma JSON pour le LLM) + fonction d'exécution.
"""
import json
import sqlite3
from datetime import datetime
from pathlib import Path

import httpx

from .agenda import AGENDA_TOOL_DEFINITIONS, create_event, delete_event, list_events
from .finance import FINANCE_TOOL_DEFINITIONS, crypto_data, market_overview, stock_data
from .prefs import PREFS_TOOL_DEFINITION, update_preferences
from .documents import DOCUMENT_TOOL_DEFINITION, create_document
from .routing import ROUTE_TOOL_DEFINITION, get_route
from .rag import (
    RAG_TOOL_DEFINITIONS,
    extract_text,
    index_document,
    list_indexed,
    search_documents,
)

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
            params={"name": city, "count": 5, "language": "fr"},
        )
        results = geo.json().get("results")
        if not results:
            return f"Ville introuvable : {city}", {}
        # À nom égal, on privilégie la France (Brest, Bretagne != Brest, Biélorussie).
        loc = next((r for r in results if r.get("country_code") == "FR"), results[0])
        meteo = await client.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": loc["latitude"],
                "longitude": loc["longitude"],
                "current": "temperature_2m,apparent_temperature,weather_code,"
                "wind_speed_10m,wind_gusts_10m,relative_humidity_2m,uv_index",
                "daily": "temperature_2m_max,temperature_2m_min,weather_code,"
                "precipitation_probability_max,sunrise,sunset",
                "forecast_days": 7,
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
        "feels": cur.get("apparent_temperature"),
        "desc": WEATHER_CODES.get(cur["weather_code"], ""),
        "code": cur["weather_code"],
        "wind": cur["wind_speed_10m"],
        "gusts": cur.get("wind_gusts_10m"),
        "humidity": cur["relative_humidity_2m"],
        "uv": cur.get("uv_index"),
        "sunrise": (days.get("sunrise") or [""])[0][-5:],
        "sunset": (days.get("sunset") or [""])[0][-5:],
        "days": [
            {
                "date": days["time"][i],
                "min": days["temperature_2m_min"][i],
                "max": days["temperature_2m_max"][i],
                "code": days["weather_code"][i],
                "desc": WEATHER_CODES.get(days["weather_code"][i], ""),
                "rain": (days.get("precipitation_probability_max") or [None] * 7)[i],
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
    try:
        text = extract_text(target)
    except ValueError as e:
        return str(e)
    return text[:20000] + ("\n[... tronqué]" if len(text) > 20000 else "")


def web_search(query: str, max_results: int = 6) -> str:
    """Recherche DuckDuckGo (gratuit, sans clé)."""
    from ddgs import DDGS

    results = DDGS().text(query, region="fr-fr", max_results=max_results)
    if not results:
        return "Aucun résultat."
    return "\n\n".join(
        f"[{r['title']}]({r['href']})\n{r['body']}" for r in results
    )


async def read_webpage(url: str) -> str:
    """Télécharge une page web et la convertit en texte brut."""
    import re

    async with httpx.AsyncClient(
        timeout=15, follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
    ) as client:
        r = await client.get(url)
    html = r.text
    html = re.sub(r"<(script|style|nav|footer|header)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:15000] + ("\n[... tronqué]" if len(text) > 15000 else "")


def send_email(to: str, subject: str, body: str) -> str:
    """Envoie un email via Gmail SMTP (GMAIL_ADDRESS + GMAIL_APP_PASSWORD dans .env)."""
    import os
    import smtplib
    from email.mime.text import MIMEText

    from dotenv import load_dotenv

    load_dotenv(Path(__file__).parent.parent / ".env")
    sender = os.getenv("GMAIL_ADDRESS")
    password = os.getenv("GMAIL_APP_PASSWORD")
    if not sender or not password:
        return (
            "Email non configuré : Antoine doit mettre GMAIL_ADDRESS et "
            "GMAIL_APP_PASSWORD (mot de passe d'application Google) dans backend/.env"
        )
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
        smtp.login(sender, password)
        smtp.send_message(msg)
    return f"Email envoyé à {to}."


def travel_links(
    origin: str,
    destination: str,
    depart: str,
    origin_iata: str = "",
    destination_iata: str = "",
    return_date: str = "",
) -> str:
    """Génère des liens de recherche pré-remplis (vols + logements)."""
    from urllib.parse import quote

    d = depart  # YYYY-MM-DD
    r = return_date
    yymmdd = d[2:4] + d[5:7] + d[8:10]
    gf_query = f"Flights from {origin} to {destination} on {d}"
    if r:
        gf_query += f" returning {r}"
    lines = [
        f"Liens de recherche {origin} → {destination} ({d}{' / retour ' + r if r else ''}) :",
        f"- [Google Flights](https://www.google.com/travel/flights?q={quote(gf_query)})",
    ]
    if origin_iata and destination_iata:
        kayak = f"https://www.kayak.fr/flights/{origin_iata}-{destination_iata}/{d}"
        if r:
            kayak += f"/{r}"
        sky = f"https://www.skyscanner.fr/transport/vols/{origin_iata.lower()}/{destination_iata.lower()}/{yymmdd}/"
        if r:
            sky += r[2:4] + r[5:7] + r[8:10] + "/"
        lines += [f"- [Kayak]({kayak})", f"- [Skyscanner]({sky})"]
    if r:
        lines += [
            f"- [Booking](https://www.booking.com/searchresults.fr.html?ss={quote(destination)}&checkin={d}&checkout={r})",
            f"- [Airbnb](https://www.airbnb.fr/s/{quote(destination)}/homes?checkin={d}&checkout={r})",
        ]
    lines.append(
        "\nPrésente ces liens markdown tels quels à l'utilisateur, il peut cliquer dessus."
    )
    return "\n".join(lines)


TOOL_DEFINITIONS = FINANCE_TOOL_DEFINITIONS + [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": (
                "Recherche sur internet (DuckDuckGo). À utiliser pour l'actualité "
                "et les informations générales. NE PAS utiliser pour les prix ou "
                "indicateurs financiers : utiliser crypto_data / stock_data / "
                "market_overview qui donnent les vraies données chiffrées."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Requête de recherche"},
                    "max_results": {"type": "integer", "description": "Défaut 6"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_webpage",
            "description": "Lit le contenu texte d'une page web à partir de son URL (pour approfondir un résultat de recherche).",
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string"}},
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_email",
            "description": "Envoie un email. IMPORTANT : toujours montrer le brouillon à l'utilisateur et attendre sa confirmation explicite avant d'appeler ce tool.",
            "parameters": {
                "type": "object",
                "properties": {
                    "to": {"type": "string", "description": "Adresse du destinataire"},
                    "subject": {"type": "string"},
                    "body": {"type": "string", "description": "Corps du mail en texte"},
                },
                "required": ["to", "subject", "body"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "travel_links",
            "description": (
                "Génère des liens de recherche pré-remplis vers Google Flights, "
                "Kayak, Skyscanner (vols) et Booking/Airbnb (logements si date "
                "de retour fournie). Aucune clé API requise — à privilégier pour "
                "chercher des vols ou logements."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "origin": {"type": "string", "description": "Ville de départ"},
                    "destination": {"type": "string", "description": "Ville d'arrivée"},
                    "origin_iata": {"type": "string", "description": "Code IATA départ si connu, ex: PAR"},
                    "destination_iata": {"type": "string", "description": "Code IATA arrivée si connu, ex: LIS"},
                    "depart": {"type": "string", "description": "Date aller YYYY-MM-DD"},
                    "return_date": {"type": "string", "description": "Date retour YYYY-MM-DD, optionnel"},
                },
                "required": ["origin", "destination", "depart"],
            },
        },
    },
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
            "description": "Lit un fichier du dossier Documents (pdf, docx, txt, md, csv, json, log) pour le synthétiser.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string", "description": "Chemin relatif à Documents"}},
                "required": ["path"],
            },
        },
    },
] + RAG_TOOL_DEFINITIONS + [ROUTE_TOOL_DEFINITION, DOCUMENT_TOOL_DEFINITION, PREFS_TOOL_DEFINITION] + AGENDA_TOOL_DEFINITIONS


async def execute_tool(name: str, args: dict) -> tuple[str, dict | None]:
    """Retourne (texte pour le LLM, widget UI optionnel)."""
    try:
        if name == "get_weather":
            text, widget = await get_weather(**args)
            return text, {"widget": "weather", "data": widget} if widget else None
        if name == "read_webpage":
            return await read_webpage(**args), None
        if name == "get_route":
            return await get_route(**args)
        if name == "crypto_data":
            return await crypto_data(**args), None
        if name == "stock_data":
            return await stock_data(**args), None
        if name == "market_overview":
            return await market_overview(), None
        if name == "index_document":
            return await index_document(**args), None
        if name == "search_documents":
            return await search_documents(**args), None
        if name == "list_indexed":
            return list_indexed(), None
        sync = {
            "update_preferences": update_preferences,
            "create_document": create_document,
            "create_event": create_event,
            "list_events": list_events,
            "delete_event": delete_event,
            "web_search": web_search,
            "send_email": send_email,
            "travel_links": travel_links,
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
