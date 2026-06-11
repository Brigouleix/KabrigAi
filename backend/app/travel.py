"""Tools voyage via Amadeus Self-Service API (free tier).

Nécessite AMADEUS_API_KEY et AMADEUS_API_SECRET dans backend/.env
(compte gratuit sur https://developers.amadeus.com).
"""
import os
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

AMADEUS_BASE = "https://test.api.amadeus.com"
_token: dict = {"value": None, "expires": 0.0}

MISSING_KEYS_MSG = (
    "Les clés Amadeus ne sont pas configurées. Antoine doit créer un compte "
    "gratuit sur developers.amadeus.com et mettre AMADEUS_API_KEY et "
    "AMADEUS_API_SECRET dans backend/.env"
)


def _has_keys() -> bool:
    return bool(os.getenv("AMADEUS_API_KEY") and os.getenv("AMADEUS_API_SECRET"))


async def _get_token(client: httpx.AsyncClient) -> str:
    if _token["value"] and time.time() < _token["expires"]:
        return _token["value"]
    r = await client.post(
        f"{AMADEUS_BASE}/v1/security/oauth2/token",
        data={
            "grant_type": "client_credentials",
            "client_id": os.getenv("AMADEUS_API_KEY"),
            "client_secret": os.getenv("AMADEUS_API_SECRET"),
        },
    )
    r.raise_for_status()
    data = r.json()
    _token["value"] = data["access_token"]
    _token["expires"] = time.time() + data.get("expires_in", 1800) - 60
    return _token["value"]


async def _city_code(client: httpx.AsyncClient, token: str, city: str) -> str | None:
    r = await client.get(
        f"{AMADEUS_BASE}/v1/reference-data/locations",
        headers={"Authorization": f"Bearer {token}"},
        params={"keyword": city, "subType": "CITY,AIRPORT", "page[limit]": 1},
    )
    data = r.json().get("data")
    return data[0]["iataCode"] if data else None


async def search_flights(
    origin: str, destination: str, date: str, adults: int = 1
) -> tuple[str, dict | None]:
    """Vols : origin/destination en nom de ville ou code IATA, date YYYY-MM-DD."""
    if not _has_keys():
        return MISSING_KEYS_MSG, None
    async with httpx.AsyncClient(timeout=30) as client:
        token = await _get_token(client)
        orig = origin if len(origin) == 3 and origin.isupper() else await _city_code(client, token, origin)
        dest = destination if len(destination) == 3 and destination.isupper() else await _city_code(client, token, destination)
        if not orig or not dest:
            return f"Aéroport introuvable pour {origin if not orig else destination}.", None
        r = await client.get(
            f"{AMADEUS_BASE}/v2/shopping/flight-offers",
            headers={"Authorization": f"Bearer {token}"},
            params={
                "originLocationCode": orig,
                "destinationLocationCode": dest,
                "departureDate": date,
                "adults": adults,
                "max": 5,
                "currencyCode": "EUR",
            },
        )
    if r.status_code != 200:
        return f"Erreur Amadeus ({r.status_code}) : {r.text[:300]}", None
    offers = r.json().get("data", [])
    if not offers:
        return f"Aucun vol trouvé {orig} → {dest} le {date}.", None

    flights = []
    for o in offers:
        itin = o["itineraries"][0]
        segs = itin["segments"]
        flights.append({
            "price": o["price"]["grandTotal"],
            "currency": o["price"]["currency"],
            "carrier": segs[0]["carrierCode"],
            "departure": segs[0]["departure"]["at"],
            "arrival": segs[-1]["arrival"]["at"],
            "from": segs[0]["departure"]["iataCode"],
            "to": segs[-1]["arrival"]["iataCode"],
            "stops": len(segs) - 1,
            "duration": itin["duration"].removeprefix("PT").lower(),
        })
    text = f"Vols {orig} → {dest} le {date} :\n" + "\n".join(
        f"- {f['carrier']} {f['departure'][11:16]}→{f['arrival'][11:16]}, "
        f"{f['stops']} escale(s), {f['duration']}, {f['price']} {f['currency']}"
        for f in flights
    )
    widget = {"widget": "flights", "data": {"origin": orig, "destination": dest, "date": date, "flights": flights}}
    return text, widget


async def search_hotels(
    city: str, checkin: str, checkout: str, adults: int = 2
) -> tuple[str, dict | None]:
    """Hôtels dans une ville, dates YYYY-MM-DD."""
    if not _has_keys():
        return MISSING_KEYS_MSG, None
    async with httpx.AsyncClient(timeout=30) as client:
        token = await _get_token(client)
        code = await _city_code(client, token, city)
        if not code:
            return f"Ville introuvable : {city}", None
        r = await client.get(
            f"{AMADEUS_BASE}/v1/reference-data/locations/hotels/by-city",
            headers={"Authorization": f"Bearer {token}"},
            params={"cityCode": code, "radius": 10},
        )
        hotels = r.json().get("data", [])[:20]
        if not hotels:
            return f"Aucun hôtel trouvé à {city}.", None
        ids = ",".join(h["hotelId"] for h in hotels)
        r = await client.get(
            f"{AMADEUS_BASE}/v3/shopping/hotel-offers",
            headers={"Authorization": f"Bearer {token}"},
            params={
                "hotelIds": ids,
                "checkInDate": checkin,
                "checkOutDate": checkout,
                "adults": adults,
                "currency": "EUR",
                "bestRateOnly": True,
            },
        )
    offers = r.json().get("data", [])
    if not offers:
        return f"Aucune disponibilité à {city} du {checkin} au {checkout}.", None

    results = []
    for o in offers[:8]:
        offer = o["offers"][0]
        results.append({
            "name": o["hotel"]["name"].title(),
            "price": offer["price"]["total"],
            "currency": offer["price"].get("currency", "EUR"),
        })
    text = f"Hôtels à {city} ({checkin} → {checkout}) :\n" + "\n".join(
        f"- {h['name']} : {h['price']} {h['currency']}" for h in results
    )
    return text, None


TRAVEL_TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "search_flights",
            "description": "Recherche de vols entre deux villes à une date donnée.",
            "parameters": {
                "type": "object",
                "properties": {
                    "origin": {"type": "string", "description": "Ville ou code IATA de départ"},
                    "destination": {"type": "string", "description": "Ville ou code IATA d'arrivée"},
                    "date": {"type": "string", "description": "Date de départ YYYY-MM-DD"},
                    "adults": {"type": "integer", "description": "Nombre d'adultes, défaut 1"},
                },
                "required": ["origin", "destination", "date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_hotels",
            "description": "Recherche d'hôtels disponibles dans une ville pour des dates données.",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string"},
                    "checkin": {"type": "string", "description": "YYYY-MM-DD"},
                    "checkout": {"type": "string", "description": "YYYY-MM-DD"},
                    "adults": {"type": "integer", "description": "Défaut 2"},
                },
                "required": ["city", "checkin", "checkout"],
            },
        },
    },
]
