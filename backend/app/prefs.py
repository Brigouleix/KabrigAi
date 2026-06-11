"""Préférences utilisateur : personnalisation de l'accueil.

Modifiables depuis l'UI (chips, champ ville) ET par Kabrig lui-même via le
tool update_preferences ("ne me montre que le rugby", "cache la météo"...).
"""
import json
from pathlib import Path

PREFS_PATH = Path(__file__).parent.parent / "prefs.json"

VALID_SPORTS = ["tous", "football", "rugby", "tennis", "basket", "cyclisme", "formule 1"]
VALID_TILES = ["weather", "agenda", "sport", "sorties", "mail", "spotify", "whatsapp"]

DEFAULTS = {
    "user_name": "Antoine",
    "ai_name": "Kabrig",
    "city": "Brest",
    "sports": ["tous"],
    "tiles": ["weather", "agenda", "sport", "sorties", "mail", "spotify", "whatsapp"],
    "spotify": "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
    "sizes": {},  # tuile -> s | m | l
    "custom": [],  # [{"id", "title", "query"}] tuiles créées par l'utilisateur
}

# Chemins RSS L'Équipe par sport.
SPORT_FEEDS = {
    "tous": "/Tous%20sports",
    "football": "/Football",
    "rugby": "/Rugby",
    "tennis": "/Tennis",
    "basket": "/Basket",
    "cyclisme": "/Cyclisme",
    "formule 1": "/Formule%201",
}


def get_prefs() -> dict:
    prefs = dict(DEFAULTS)
    if PREFS_PATH.exists():
        try:
            prefs.update(json.loads(PREFS_PATH.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            pass
    return prefs


def _slug(title: str) -> str:
    import re

    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:30] or "tuile"


def set_prefs(
    city: str | None = None,
    sports: list[str] | None = None,
    tiles: list[str] | None = None,
    spotify: str | None = None,
    sizes: dict | None = None,
    add_tile: dict | None = None,
    remove_tile: str | None = None,
    show_tile: str | None = None,
    hide_tile: str | None = None,
    reset_tiles: bool = False,
    user_name: str | None = None,
    ai_name: str | None = None,
) -> dict:
    prefs = get_prefs()
    if city:
        prefs["city"] = city.strip()
    if user_name:
        prefs["user_name"] = user_name.strip()
    if ai_name:
        prefs["ai_name"] = ai_name.strip()
    if reset_tiles:
        prefs["tiles"] = list(DEFAULTS["tiles"]) + [f"custom:{c['id']}" for c in prefs["custom"]]
        prefs["sizes"] = {}
    if spotify and "open.spotify.com" in spotify:
        prefs["spotify"] = spotify.strip()
    if sports is not None:
        valid = [s for s in sports if s in VALID_SPORTS]
        if valid:
            prefs["sports"] = valid
    if add_tile and add_tile.get("title") and add_tile.get("query"):
        tile_id = _slug(add_tile["title"])
        prefs["custom"] = [c for c in prefs["custom"] if c["id"] != tile_id]
        prefs["custom"].append(
            {"id": tile_id, "title": add_tile["title"], "query": add_tile["query"]}
        )
        if f"custom:{tile_id}" not in prefs["tiles"]:
            prefs["tiles"].append(f"custom:{tile_id}")
    if remove_tile:
        rid = _slug(remove_tile)
        prefs["custom"] = [c for c in prefs["custom"] if c["id"] != rid]
        prefs["tiles"] = [
            t for t in prefs["tiles"] if t not in (remove_tile, f"custom:{rid}")
        ]
    custom_ids = {f"custom:{c['id']}" for c in prefs["custom"]}
    if hide_tile:
        prefs["tiles"] = [t for t in prefs["tiles"] if t != hide_tile]
    if show_tile and (show_tile in VALID_TILES or show_tile in custom_ids):
        if show_tile not in prefs["tiles"]:
            prefs["tiles"].append(show_tile)
    if tiles is not None:
        valid = [t for t in tiles if t in VALID_TILES or t in custom_ids]
        # Garde-fou : on n'accepte une liste complète que si elle ne vide pas
        # tout (le LLM envoyait des listes partielles et écrasait l'accueil).
        if valid:
            prefs["tiles"] = valid
    if sizes is not None:
        prefs["sizes"] = {
            k: v for k, v in sizes.items() if v in ("s", "m", "l")
        }
    PREFS_PATH.write_text(json.dumps(prefs, ensure_ascii=False, indent=2), encoding="utf-8")
    return prefs


def update_preferences(
    city: str = "",
    sports: list[str] | None = None,
    spotify: str = "",
    add_tile_title: str = "",
    add_tile_query: str = "",
    remove_tile: str = "",
    show_tile: str = "",
    hide_tile: str = "",
    reset_tiles: bool = False,
    user_name: str = "",
    ai_name: str = "",
) -> str:
    add = (
        {"title": add_tile_title, "query": add_tile_query}
        if add_tile_title and add_tile_query
        else None
    )
    prefs = set_prefs(
        city or None, sports, None, spotify or None,
        add_tile=add, remove_tile=remove_tile or None,
        show_tile=show_tile or None, hide_tile=hide_tile or None,
        reset_tiles=reset_tiles,
        user_name=user_name or None, ai_name=ai_name or None,
    )
    customs = ", ".join(c["title"] for c in prefs["custom"]) or "aucune"
    return (
        "Préférences mises à jour. Accueil actuel : "
        f"ville {prefs['city']}, sports {', '.join(prefs['sports'])}, "
        f"tuiles affichées (dans l'ordre) : {', '.join(prefs['tiles']) or 'aucune'}, "
        f"tuiles personnalisées : {customs}. "
        "Dis à Antoine de rafraîchir l'accueil (⟳)."
    )


PREFS_TOOL_DEFINITION = {
    "type": "function",
    "function": {
        "name": "update_preferences",
        "description": (
            "Personnalise l'écran d'accueil de l'app selon les souhaits d'Antoine : "
            "ville par défaut, sports suivis dans la tuile sport, tuiles affichées "
            "et leur ordre. Exemples : masquer la météo, ne suivre que le rugby, "
            "mettre l'agenda en premier."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "city": {"type": "string", "description": "Ville par défaut (météo, sorties)"},
                "sports": {
                    "type": "array",
                    "items": {"type": "string", "enum": VALID_SPORTS},
                    "description": "Sports à suivre",
                },
                "show_tile": {
                    "type": "string",
                    "description": (
                        "Affiche UNE tuile masquée. Valeurs : weather (météo), agenda, "
                        "sport, sorties, mail, spotify, whatsapp, ou custom:<id>"
                    ),
                },
                "hide_tile": {
                    "type": "string",
                    "description": "Masque UNE tuile (mêmes valeurs que show_tile). Les autres restent en place.",
                },
                "reset_tiles": {
                    "type": "boolean",
                    "description": "Rétablit toutes les tuiles par défaut (ordre et tailles inclus)",
                },
                "user_name": {
                    "type": "string",
                    "description": "Nom par lequel l'assistant appelle l'utilisateur",
                },
                "ai_name": {
                    "type": "string",
                    "description": "Nouveau nom de l'assistant",
                },
                "spotify": {
                    "type": "string",
                    "description": "URL open.spotify.com d'une playlist/album à afficher dans le lecteur",
                },
                "add_tile_title": {
                    "type": "string",
                    "description": "Crée une tuile personnalisée d'actualités : son titre (ex: Crypto & Tech)",
                },
                "add_tile_query": {
                    "type": "string",
                    "description": "Requête d'actualités qui alimente la tuile (ex: crypto bourse actualités tech)",
                },
                "remove_tile": {
                    "type": "string",
                    "description": "Supprime une tuile personnalisée par son titre",
                },
            },
        },
    },
}
