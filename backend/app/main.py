"""Kabrig AI - Backend FastAPI.

Deux LLMs locaux via Ollama :
- LIGHT : routage, classification, tâches rapides
- HEAVY : synthèse, rédaction, raisonnement, tool calling complexe
"""
import json

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .tools import TOOL_DEFINITIONS, execute_tool

OLLAMA_URL = "http://localhost:11434"
MODEL_LIGHT = "qwen2.5:7b"
MODEL_HEAVY = "qwen2.5:32b"
MAX_TOOL_ROUNDS = 5
MEMORY_THRESHOLD = 12  # au-delà, on résume les anciens messages
MEMORY_KEEP_RECENT = 6  # messages récents conservés tels quels

SYSTEM_PROMPT = (
    "Tu es Kabrig, l'assistant personnel d'Antoine. Tu réponds en français, "
    "de façon concise et utile. Tu as accès à des outils : météo, notes, "
    "lecture de documents. Utilise-les quand c'est pertinent, sans demander "
    "la permission."
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


async def route_query(messages: list[ChatMessage]) -> str:
    """Le modèle léger décide si la requête nécessite le gros modèle."""
    last = messages[-1].content
    prompt = (
        "Tu es un routeur. Réponds uniquement par LIGHT ou HEAVY.\n"
        "LIGHT : salutations, questions simples, météo, gestion de notes.\n"
        "HEAVY : rédaction, synthèse de documents, raisonnement complexe.\n"
        f"Requête : {last}"
    )
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{OLLAMA_URL}/api/generate",
            json={"model": MODEL_LIGHT, "prompt": prompt, "stream": False},
            timeout=60,
        )
    answer = r.json().get("response", "").strip().upper()
    return MODEL_HEAVY if "HEAVY" in answer else MODEL_LIGHT


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
    model = await route_query(req.messages)
    history = await compress_history(req.messages)
    convo = [{"role": "system", "content": SYSTEM_PROMPT}] + history

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
                        "tools": TOOL_DEFINITIONS,
                        "stream": False,
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
                json={"model": model, "messages": convo, "stream": True},
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
