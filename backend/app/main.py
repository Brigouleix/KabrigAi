"""Kabrig AI - Backend FastAPI.

Deux LLMs locaux via Ollama :
- LIGHT : routage, classification, tâches rapides
- HEAVY : synthèse, rédaction, raisonnement
"""
import json

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

OLLAMA_URL = "http://localhost:11434"
MODEL_LIGHT = "qwen2.5:7b"
MODEL_HEAVY = "qwen2.5:32b"

app = FastAPI(title="Kabrig AI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420", "tauri://localhost"],
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
        "LIGHT : salutations, questions simples, organisation, listes.\n"
        "HEAVY : rédaction, synthèse de documents, raisonnement complexe.\n"
        f"Requête : {last}"
    )
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{OLLAMA_URL}/api/generate",
            json={"model": MODEL_LIGHT, "prompt": prompt, "stream": False},
            timeout=30,
        )
    answer = r.json().get("response", "").strip().upper()
    return MODEL_HEAVY if "HEAVY" in answer else MODEL_LIGHT


@app.post("/api/chat")
async def chat(req: ChatRequest):
    """Chat streamé : route vers le bon modèle puis stream la réponse."""
    model = await route_query(req.messages)

    async def stream():
        yield json.dumps({"type": "model", "model": model}) + "\n"
        async with httpx.AsyncClient() as client:
            async with client.stream(
                "POST",
                f"{OLLAMA_URL}/api/chat",
                json={
                    "model": model,
                    "messages": [m.model_dump() for m in req.messages],
                    "stream": True,
                },
                timeout=None,
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
