"""Contrôle Spotify via l'API officielle (OAuth PKCE, sans secret).

Setup (une fois) :
1. https://developer.spotify.com/dashboard → Create app
2. Redirect URI : http://127.0.0.1:8000/api/spotify/callback
3. SPOTIFY_CLIENT_ID=... dans backend/.env

Note : la commande de lecture (play/pause/next) nécessite Spotify Premium ;
la recherche et le "now playing" marchent avec un compte gratuit.
"""
import base64
import hashlib
import json
import os
import secrets
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

TOKEN_PATH = Path(__file__).parent.parent / "spotify_token.json"
REDIRECT_URI = "http://127.0.0.1:8000/api/spotify/callback"
SCOPES = "user-modify-playback-state user-read-playback-state user-read-currently-playing"

_verifier: dict = {"value": ""}


def client_id() -> str:
    return os.getenv("SPOTIFY_CLIENT_ID", "")


def _save_token(data: dict) -> None:
    data["expires_at"] = time.time() + data.get("expires_in", 3600) - 60
    TOKEN_PATH.write_text(json.dumps(data), encoding="utf-8")


def _load_token() -> dict | None:
    if not TOKEN_PATH.exists():
        return None
    try:
        return json.loads(TOKEN_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def login_url() -> str:
    verifier = secrets.token_urlsafe(64)[:64]
    _verifier["value"] = verifier
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .decode()
        .rstrip("=")
    )
    params = httpx.QueryParams(
        client_id=client_id(),
        response_type="code",
        redirect_uri=REDIRECT_URI,
        scope=SCOPES,
        code_challenge_method="S256",
        code_challenge=challenge,
    )
    return f"https://accounts.spotify.com/authorize?{params}"


async def exchange_code(code: str) -> bool:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://accounts.spotify.com/api/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": REDIRECT_URI,
                "client_id": client_id(),
                "code_verifier": _verifier["value"],
            },
        )
    if r.status_code != 200:
        return False
    _save_token(r.json())
    return True


async def _access_token() -> str | None:
    token = _load_token()
    if not token:
        return None
    if time.time() < token.get("expires_at", 0):
        return token["access_token"]
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://accounts.spotify.com/api/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": token.get("refresh_token", ""),
                "client_id": client_id(),
            },
        )
    if r.status_code != 200:
        return None
    data = r.json()
    data.setdefault("refresh_token", token.get("refresh_token"))
    _save_token(data)
    return data["access_token"]


async def _api(method: str, path: str, **kwargs) -> httpx.Response | None:
    token = await _access_token()
    if not token:
        return None
    async with httpx.AsyncClient(timeout=15) as client:
        return await client.request(
            method,
            f"https://api.spotify.com/v1{path}",
            headers={"Authorization": f"Bearer {token}"},
            **kwargs,
        )


def status() -> dict:
    return {"configured": bool(client_id()), "connected": _load_token() is not None}


async def now_playing() -> dict:
    r = await _api("GET", "/me/player")
    if r is None or r.status_code != 200 or not r.text:
        return {"playing": False}
    data = r.json()
    item = data.get("item") or {}
    return {
        "playing": data.get("is_playing", False),
        "track": item.get("name", ""),
        "artist": ", ".join(a["name"] for a in item.get("artists", [])),
        "device": (data.get("device") or {}).get("name", ""),
    }


async def control(action: str) -> dict:
    routes = {
        "play": ("PUT", "/me/player/play"),
        "pause": ("PUT", "/me/player/pause"),
        "next": ("POST", "/me/player/next"),
        "previous": ("POST", "/me/player/previous"),
    }
    if action not in routes:
        return {"error": "action inconnue"}
    method, path = routes[action]
    r = await _api(method, path)
    if r is not None and r.status_code == 403:
        return {"error": "Spotify Premium requis pour contrôler la lecture."}
    if r is not None and r.status_code == 404:
        return {"error": "Aucun appareil Spotify actif. Lance Spotify quelque part d'abord."}
    return await now_playing()


async def search_and_play(query: str) -> dict:
    r = await _api("GET", "/search", params={"q": query, "type": "track", "limit": 1})
    if r is None or r.status_code != 200:
        return {"error": "Recherche impossible (reconnecte Spotify ?)."}
    tracks = r.json().get("tracks", {}).get("items", [])
    if not tracks:
        return {"error": f"Aucun titre trouvé pour « {query} »."}
    track = tracks[0]
    play = await _api("PUT", "/me/player/play", json={"uris": [track["uri"]]})
    if play is not None and play.status_code == 403:
        return {"error": "Spotify Premium requis pour lancer un titre."}
    if play is not None and play.status_code == 404:
        return {"error": "Aucun appareil actif. Ouvre Spotify (PC/téléphone) puis réessaie."}
    return {
        "playing": True,
        "track": track["name"],
        "artist": ", ".join(a["name"] for a in track["artists"]),
        "url": track["external_urls"]["spotify"],
    }
