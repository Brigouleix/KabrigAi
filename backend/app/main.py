"""Kabrig AI - Backend FastAPI.

Deux LLMs locaux via Ollama :
- LIGHT : routage, classification, tâches rapides
- HEAVY : synthèse, rédaction, raisonnement, tool calling complexe
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import httpx
from fastapi import FastAPI, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .agenda import create_event as agenda_create, delete_event as agenda_delete, get_events
from . import spotify as sp
from .prefs import SPORT_FEEDS, get_prefs, set_prefs
from .todos import get_todos as get_todos_list
from .tools import execute_tool, get_weather, select_tools, web_search

OLLAMA_URL = "http://localhost:11434"
MODEL_LIGHT = "qwen2.5:3b"  # chemin rapide (~2x plus vite que le 7b sur ce GPU)
MODEL_HEAVY = "qwen2.5:14b"
MAX_TOOL_ROUNDS = 5
NUM_CTX = 16384  # défaut Ollama = 4096, trop petit pour 19 tools + historique
MEMORY_THRESHOLD = 12  # au-delà, on résume les anciens messages
MEMORY_KEEP_RECENT = 6  # messages récents conservés tels quels
KEEP_ALIVE = "30m"  # garde le modèle chaud : pas de rechargement à froid entre 2 requêtes

# Mots-clés qui justifient le gros modèle (rédaction, analyse, raisonnement).
# Routage instantané : évite un appel d'inférence entier juste pour décider.
HEAVY_KEYWORDS = (
    "rédige", "redige", "écris", "ecris", "écrire", "rédaction", "mail", "e-mail",
    "courriel", "lettre", "analyse", "analyser", "synthèse", "synthese",
    "synthétise", "synthetise", "résume", "resume", "résumé", "document", "pdf",
    "docx", "rapport", "word", "excel", "bourse", "crypto", "action", "bitcoin",
    "ethereum", "marché", "marche", "économie", "economie", "investir",
    "investissement", "portefeuille", "compare", "comparer", "comparaison",
    "explique", "expliquer", "pourquoi", "stratégie", "strategie", "graphique",
    "graph", "courbe", "vol", "vols", "hôtel", "hotel", "itinéraire", "itineraire",
    "voyage", "code", "programme", "script", "traduis", "traduire", "argumente",
)


def route_query(messages: list[ChatMessage]) -> str:
    """Routage par mots-clés (instantané, sans inférence).

    HEAVY si la requête évoque rédaction/analyse/raisonnement, ou si elle est
    longue (>180 caractères = demande complexe). LIGHT sinon (météo, todo,
    agenda, salutations, questions courtes).
    """
    last = messages[-1].content.lower()
    if len(last) > 180 or any(kw in last for kw in HEAVY_KEYWORDS):
        return MODEL_HEAVY
    return MODEL_LIGHT

def system_prompt() -> str:
    from datetime import date

    prefs = get_prefs()
    ai, user = prefs["ai_name"], prefs["user_name"]
    return (
        f"Tu es {ai}, l'assistant personnel de {user} (appelle-le {user}). "
        "Tu réponds en français, "
        "de façon concise et utile. Tu as accès à des outils : météo, notes, "
        "lecture de documents, liens de recherche voyage (vols et logements), "
        "recherche internet (web_search puis read_webpage pour approfondir), "
        "RAG sur les documents (index_document une fois, puis search_documents "
        "pour répondre aux questions sur leur contenu), "
        "envoi d'emails, itinéraires (get_route), création de PDF/Word "
        "(create_document), agenda (create_event/list_events/delete_event). "
        "Utilise-les quand c'est pertinent, sans demander la "
        "permission — SAUF send_email : montre toujours le brouillon et attends "
        f"la confirmation de {user} avant d'envoyer. "
        "Pour l'accueil, modifie les tuiles UNE par UNE avec show_tile/hide_tile, "
        "jamais en bloc. "
        "Pour TOUTE question finance/crypto/bourse : commence OBLIGATOIREMENT par "
        "crypto_data, stock_data ou market_overview (vraies données chiffrées : "
        "prix, RSI, SMA, volatilité), puis complète avec web_search pour "
        "l'actualité. N'invente JAMAIS de chiffres ou d'indicateurs : cite "
        "uniquement ceux retournés par les tools. Structure l'analyse (tendance, "
        "momentum, risques, contexte) et rappelle que ce n'est pas un conseil en "
        "investissement. "
        f"Nous sommes le {date.today().isoformat()}."
    )

app = FastAPI(title="Kabrig AI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420",
        "http://localhost:5173",
        "http://tauri.localhost",
        "tauri://localhost",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def warmup():
    """Préchauffe UNIQUEMENT le modèle léger (le plus utilisé).

    NB : ne JAMAIS charger les deux modèles en même temps — sur un GPU limité
    ils se battent pour la VRAM et Ollama se bloque. Le gros modèle se charge
    à la demande et reste chaud (keep_alive) le temps d'une session.
    """

    async def _load():
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                await client.post(
                    f"{OLLAMA_URL}/api/generate",
                    json={"model": MODEL_LIGHT, "prompt": "ok", "stream": False,
                          "keep_alive": KEEP_ALIVE, "options": {"num_predict": 1}},
                )
        except httpx.HTTPError:
            pass

    asyncio.create_task(_load())  # en tâche de fond, ne bloque pas le démarrage


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


@app.get("/api/health")
async def health():
    """Vérifie que le backend et Ollama répondent."""
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{OLLAMA_URL}/api/tags", timeout=5)
            models = [m["name"] for m in r.json().get("models", [])]
        return {"status": "ok", "ollama": True, "models": models}
    except httpx.HTTPError:
        return {"status": "degraded", "ollama": False, "models": []}


async def compress_history(messages: list[ChatMessage]) -> list[dict]:
    """Résume les anciens messages avec le modèle léger pour économiser le contexte."""
    if len(messages) <= MEMORY_THRESHOLD:
        return [m.model_dump() for m in messages]
    old, recent = messages[:-MEMORY_KEEP_RECENT], messages[-MEMORY_KEEP_RECENT:]
    transcript = "\n".join(f"{m.role}: {m.content}" for m in old)
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": MODEL_LIGHT,
                "prompt": (
                    "Résume cette conversation en 5 phrases maximum, en gardant "
                    "les faits et décisions importants :\n\n" + transcript
                ),
                "stream": False,
                "keep_alive": KEEP_ALIVE,
            },
            timeout=120,
        )
    summary = r.json().get("response", "").strip()
    return [
        {"role": "system", "content": f"Résumé de la conversation précédente : {summary}"},
        *[m.model_dump() for m in recent],
    ]


@app.post("/api/chat")
async def chat(req: ChatRequest):
    """Chat avec tool calling : boucle tools (non-streamé) puis réponse streamée."""
    model = route_query(req.messages)
    history = await compress_history(req.messages)
    convo = [{"role": "system", "content": system_prompt()}] + history
    # Seuls les tools pertinents : réduit le prompt de ~24 à ~10 définitions.
    tools = select_tools(req.messages[-1].content)

    async def stream():
        yield json.dumps({"type": "model", "model": model}) + "\n"

        async with httpx.AsyncClient(timeout=None) as client:
            # Boucle de tool calling : tant que le LLM demande des tools.
            for _ in range(MAX_TOOL_ROUNDS):
                r = await client.post(
                    f"{OLLAMA_URL}/api/chat",
                    json={
                        "model": model,
                        "messages": convo,
                        "tools": tools,
                        "stream": False,
                        "keep_alive": KEEP_ALIVE,
                        # Température basse : stabilise le format des tool calls.
                        "options": {"num_ctx": NUM_CTX, "temperature": 0.2},
                    },
                )
                msg = r.json().get("message", {})
                tool_calls = msg.get("tool_calls")
                if not tool_calls:
                    # Pas de tool : si une réponse texte existe déjà, on l'émet.
                    if msg.get("content"):
                        yield json.dumps(
                            {"type": "token", "content": msg["content"]}
                        ) + "\n"
                        yield json.dumps({"type": "done"}) + "\n"
                        return
                    break

                convo.append(msg)
                for call in tool_calls:
                    fn = call["function"]
                    name = fn["name"]
                    args = fn.get("arguments") or {}
                    if isinstance(args, str):
                        args = json.loads(args)
                    yield json.dumps({"type": "tool", "name": name, "args": args}) + "\n"
                    result, widget = await execute_tool(name, args)
                    if widget:
                        yield json.dumps({"type": "widget", **widget}) + "\n"
                    convo.append({"role": "tool", "content": result})

            # Réponse finale streamée (sans tools pour forcer la synthèse).
            async with client.stream(
                "POST",
                f"{OLLAMA_URL}/api/chat",
                json={
                    "model": model,
                    "messages": convo,
                    "stream": True,
                    "keep_alive": KEEP_ALIVE,
                    "options": {"num_ctx": NUM_CTX},
                },
            ) as r:
                async for line in r.aiter_lines():
                    if not line:
                        continue
                    data = json.loads(line)
                    content = data.get("message", {}).get("content", "")
                    if content:
                        yield json.dumps({"type": "token", "content": content}) + "\n"

        yield json.dumps({"type": "done"}) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")


UPLOAD_DIR = Path.home() / "Documents" / "Kabrig" / "imports"


@app.post("/api/upload")
async def upload(file: UploadFile):
    """Reçoit un fichier importé depuis l'UI, le sauve dans Documents/Kabrig/imports."""
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    target = UPLOAD_DIR / Path(file.filename or "import").name
    target.write_bytes(await file.read())
    rel = str(target.relative_to(Path.home() / "Documents"))
    return {"saved": rel}


class EventIn(BaseModel):
    title: str
    date: str
    time: str = ""
    location: str = ""
    notes: str = ""


class ChatSave(BaseModel):
    id: int | None = None
    messages: list


@app.get("/api/chats")
async def chats_list():
    from .chats import list_chats

    return {"chats": list_chats()}


@app.get("/api/chats/{chat_id}")
async def chats_get(chat_id: int):
    from .chats import get_chat

    return get_chat(chat_id) or {"id": None, "messages": []}


@app.post("/api/chats")
async def chats_save(body: ChatSave):
    from .chats import save_chat

    return save_chat(body.id, body.messages)


@app.delete("/api/chats/{chat_id}")
async def chats_delete(chat_id: int):
    from .chats import delete_chat, list_chats

    delete_chat(chat_id)
    return {"chats": list_chats()}


class TodoIn(BaseModel):
    text: str


@app.get("/api/todos")
async def todos_list():
    from .todos import get_todos

    return {"todos": get_todos()}


@app.post("/api/todos")
async def todos_add(body: TodoIn):
    from .todos import add_todo, get_todos

    add_todo(body.text)
    return {"todos": get_todos()}


@app.post("/api/todos/{todo_id}/toggle")
async def todos_toggle(todo_id: int):
    from .todos import get_todos, toggle_todo

    toggle_todo(todo_id)
    return {"todos": get_todos()}


@app.delete("/api/todos/{todo_id}")
async def todos_delete(todo_id: int):
    from .todos import delete_todo, get_todos

    delete_todo(todo_id)
    return {"todos": get_todos()}


@app.post("/api/todos/clear-done")
async def todos_clear_done():
    from .todos import clear_done, get_todos

    clear_done()
    return {"todos": get_todos()}


@app.get("/api/agenda")
async def agenda_list(include_past: bool = False):
    return {"events": get_events(include_past)}


@app.post("/api/agenda")
async def agenda_add(event: EventIn):
    agenda_create(**event.model_dump())
    return {"events": get_events()}


@app.delete("/api/agenda/{event_id}")
async def agenda_remove(event_id: int):
    agenda_delete(event_id)
    return {"events": get_events()}


class PrefsIn(BaseModel):
    city: str | None = None
    sports: list[str] | None = None
    tiles: list[str] | None = None
    spotify: str | None = None
    sizes: dict | None = None
    add_tile: dict | None = None
    remove_tile: str | None = None
    show_tile: str | None = None
    hide_tile: str | None = None
    reset_tiles: bool = False
    user_name: str | None = None
    ai_name: str | None = None


@app.get("/api/prefs")
async def prefs_get():
    return get_prefs()


@app.post("/api/prefs")
async def prefs_set(p: PrefsIn):
    return set_prefs(
        p.city, p.sports, p.tiles, p.spotify,
        sizes=p.sizes, add_tile=p.add_tile, remove_tile=p.remove_tile,
        show_tile=p.show_tile, hide_tile=p.hide_tile, reset_tiles=p.reset_tiles,
        user_name=p.user_name, ai_name=p.ai_name,
    )


@app.get("/api/spotify/status")
async def spotify_status():
    data = sp.status()
    if data["connected"]:
        data["player"] = await sp.now_playing()
    return data


@app.get("/api/spotify/login")
async def spotify_login():
    if not sp.client_id():
        return {"error": "SPOTIFY_CLIENT_ID manquant dans backend/.env"}
    return {"url": sp.login_url()}


@app.get("/api/spotify/callback")
async def spotify_callback(code: str = ""):
    from fastapi.responses import HTMLResponse

    ok = await sp.exchange_code(code) if code else False
    msg = "✅ Spotify connecté ! Tu peux fermer cet onglet." if ok else "❌ Échec de la connexion Spotify."
    return HTMLResponse(f"<html><body style='font-family:sans-serif;text-align:center;padding-top:80px'><h2>{msg}</h2></body></html>")


@app.post("/api/spotify/control/{action}")
async def spotify_control(action: str):
    return await sp.control(action)


@app.get("/api/spotify/play")
async def spotify_play(q: str):
    return await sp.search_and_play(q)


@app.get("/api/spotify/search")
async def spotify_search(q: str):
    """Trouve un titre/album/artiste Spotify par son nom et le met dans la tuile."""
    import re

    from ddgs import DDGS

    results = await asyncio.to_thread(
        lambda: DDGS().text(f"site:open.spotify.com {q}", max_results=10)
    )
    for r in results or []:
        m = re.search(
            r"open\.spotify\.com/(?:intl-\w+/)?(track|album|playlist|artist)/([A-Za-z0-9]+)",
            r.get("href", ""),
        )
        if m:
            url = f"https://open.spotify.com/{m.group(1)}/{m.group(2)}"
            return set_prefs(spotify=url)
    return get_prefs()


def _fetch_mailbox() -> dict:
    """Derniers mails non lus via Gmail IMAP (mêmes identifiants que l'envoi)."""
    import email
    import imaplib
    import os
    from email.header import decode_header

    from dotenv import load_dotenv

    load_dotenv(Path(__file__).parent.parent / ".env")
    sender = os.getenv("GMAIL_ADDRESS")
    password = os.getenv("GMAIL_APP_PASSWORD")
    if not sender or not password:
        return {"configured": False, "messages": []}

    def _decode(value: str) -> str:
        parts = decode_header(value or "")
        return "".join(
            p.decode(enc or "utf-8", errors="replace") if isinstance(p, bytes) else p
            for p, enc in parts
        )

    box = imaplib.IMAP4_SSL("imap.gmail.com")
    box.login(sender, password)
    box.select("INBOX", readonly=True)
    _, data = box.search(None, "UNSEEN")
    ids = data[0].split()
    unread = len(ids)
    messages = []
    for mid in reversed(ids[-5:]):
        _, msg_data = box.fetch(mid, "(BODY.PEEK[HEADER.FIELDS (SUBJECT FROM)])")
        msg = email.message_from_bytes(msg_data[0][1])
        sender_name = _decode(msg.get("From", "")).split("<")[0].strip().strip('"')
        messages.append({"subject": _decode(msg.get("Subject", "(sans objet)")), "from": sender_name})
    box.logout()
    return {"configured": True, "unread": unread, "messages": messages}


async def _fetch_sport_feed(client: httpx.AsyncClient, sport: str) -> list[dict]:
    """Flux RSS L'Équipe d'un sport : (timestamp, item)."""
    import xml.etree.ElementTree as ET
    from email.utils import parsedate_to_datetime

    r = await client.get(
        f"https://dwh.lequipe.fr/api/edito/rss?path={SPORT_FEEDS[sport]}",
        headers={"User-Agent": "KabrigAI/1.0"},
    )
    items = []
    for item in ET.fromstring(r.text).iter("item"):
        title = item.findtext("title", "").strip()
        link = item.findtext("link", "").strip()
        try:
            dt = parsedate_to_datetime(item.findtext("pubDate", ""))
        except (ValueError, TypeError):
            continue
        if title and link:
            label = sport.capitalize() if sport != "tous" else "L'Équipe"
            items.append({
                "ts": dt.timestamp(),
                "title": title,
                "url": link,
                "source": f"{label} {dt.strftime('%H:%M')}",
            })
        if len(items) >= 8:
            break
    return items


@app.get("/api/dashboard")
async def dashboard(city: str = ""):
    """Agrège les tuiles de l'accueil : météo, sport, sorties, agenda."""
    prefs = get_prefs()
    city = city or prefs["city"]

    async def weather():
        _, widget = await get_weather(city)
        return widget

    async def sport():
        sports = prefs["sports"] or ["tous"]
        async with httpx.AsyncClient(timeout=10) as client:
            feeds = await asyncio.gather(
                *[_fetch_sport_feed(client, s) for s in sports],
                return_exceptions=True,
            )
        merged = [it for f in feeds if isinstance(f, list) for it in f]
        merged.sort(key=lambda x: x["ts"], reverse=True)
        return [{k: v for k, v in it.items() if k != "ts"} for it in merged[:8]]

    async def sorties():
        results = await asyncio.to_thread(
            lambda: web_search(f"idées sortie activités weekend {city}", max_results=4)
        )
        return results

    async def custom_tiles():
        from ddgs import DDGS

        out = {}
        for c in prefs.get("custom", []):
            try:
                res = await asyncio.to_thread(
                    lambda q=c["query"]: DDGS().news(q, region="fr-fr", max_results=5)
                )
                out[c["id"]] = [
                    {"title": r["title"], "url": r["url"], "source": r.get("source", "")}
                    for r in res or []
                ]
            except Exception:
                out[c["id"]] = []
        return out

    async def safe(coro, fallback):
        try:
            return await coro
        except Exception:
            return fallback

    weather_data, sport_data, sorties_data, mail_data, custom_data = await asyncio.gather(
        safe(weather(), {}),
        safe(sport(), []),
        safe(sorties(), ""),
        safe(asyncio.to_thread(_fetch_mailbox), {"configured": False, "messages": []}),
        safe(custom_tiles(), {}),
    )
    return {
        "weather": weather_data,
        "sport": sport_data,
        "sorties": sorties_data,
        "mail": mail_data,
        "custom": custom_data,
        "events": get_events()[:5],
        "todos": get_todos_list(),
        "prefs": prefs,
    }
