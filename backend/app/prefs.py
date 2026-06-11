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
    "city": "Brest",
    "sports": ["tous"],
    "tiles": ["weather", "agenda", "sport", "sorties", "mail", "spotify", "whatsapp"],
    "spotify": "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
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


def set_prefs(
    city: str | None = None,
    sports: list[str] | None = None,
    tiles: list[str] | None = None,
    spotify: str | None = None,
) -> dict:
    prefs = get_prefs()
    if city:
        prefs["city"] = city.strip()
    if spotify and "open.spotify.com" in spotify:
        prefs["spotify"] = spotify.strip()
    if sports is not None:
        valid = [s for s in sports if s in VALID_SPORTS]
        if valid:
            prefs["sports"] = valid
    if tiles is not None:
        valid = [t for t in tiles if t in VALID_TILES]
        prefs["tiles"] = valid  # liste vide autorisée = tout masquer
    PREFS_PATH.write_text(json.dumps(prefs, ensure_ascii=False, indent=2), encoding="utf-8")
    return prefs


def update_preferences(
    city: str = "",
    sports: list[str] | None = None,
    tiles: list[str] | None = None,
    spotify: str = "",
) -> str:
    prefs = set_prefs(city or None, sports, tiles, spotify or None)
    return (
        "Préférences mises à jour. Accueil actuel : "
        f"ville {prefs['city']}, sports {', '.join(prefs['sports'])}, "
        f"tuiles affichées (dans l'ordre) : {', '.join(prefs['tiles']) or 'aucune'}. "
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
                "tiles": {
                    "type": "array",
                    "items": {"type": "string", "enum": VALID_TILES},
                    "description": (
                        "Tuiles à afficher, dans l'ordre voulu. Omettre une tuile la masque. "
                        "weather=météo, agenda, sport, sorties=idées de sortie, "
                        "mail=boîte Gmail, spotify=lecteur, whatsapp"
                    ),
                },
                "spotify": {
                    "type": "string",
                    "description": "URL open.spotify.com d'une playlist/album à afficher dans le lecteur",
                },
            },
        },
    },
}
