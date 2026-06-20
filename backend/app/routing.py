"""Itinéraires via OSRM (serveurs FOSSGIS gratuits) + géocodage Nominatim."""

import httpx

HEADERS = {"User-Agent": "KabrigAI/1.0 (assistant personnel)"}
OSRM_PROFILES = {
    "voiture": "routed-car/route/v1/driving",
    "velo": "routed-bike/route/v1/cycling",
    "pieton": "routed-foot/route/v1/walking",
}


async def _geocode(client: httpx.AsyncClient, place: str) -> dict | None:
    r = await client.get(
        "https://nominatim.openstreetmap.org/search",
        params={"q": place, "format": "json", "limit": 1},
        headers=HEADERS,
    )
    data = r.json()
    return data[0] if data else None


def _fmt_duration(seconds: float) -> str:
    minutes = int(seconds // 60)
    if minutes < 60:
        return f"{minutes} min"
    return f"{minutes // 60} h {minutes % 60:02d}"


async def get_route(
    origin: str,
    destination: str,
    mode: str = "voiture",
    origin_coords: tuple[float, float] | None = None,
    dest_coords: tuple[float, float] | None = None,
) -> tuple[str, dict | None]:
    """Itinéraire entre deux lieux (adresses ou villes).

    Si origin_coords/dest_coords sont fournis (lieu choisi dans l'autocomplétion),
    on les utilise directement — adresses précises sans re-géocodage.
    """
    profile = OSRM_PROFILES.get(mode, OSRM_PROFILES["voiture"])
    async with httpx.AsyncClient(timeout=20) as client:
        start = (
            {"lat": origin_coords[0], "lon": origin_coords[1], "display_name": origin}
            if origin_coords
            else await _geocode(client, origin)
        )
        end = (
            {"lat": dest_coords[0], "lon": dest_coords[1], "display_name": destination}
            if dest_coords
            else await _geocode(client, destination)
        )
        if not start or not end:
            return f"Lieu introuvable : {origin if not start else destination}", None
        r = await client.get(
            f"https://routing.openstreetmap.de/{profile}/"
            f"{start['lon']},{start['lat']};{end['lon']},{end['lat']}",
            params={"overview": "simplified", "geometries": "geojson", "steps": "true"},
            headers=HEADERS,
        )
    data = r.json()
    if data.get("code") != "Ok" or not data.get("routes"):
        return f"Aucun itinéraire trouvé entre {origin} et {destination}.", None

    route = data["routes"][0]
    km = route["distance"] / 1000
    duration = _fmt_duration(route["duration"])

    # Étapes principales : noms de routes dédupliqués consécutifs.
    roads: list[str] = []
    for leg in route["legs"]:
        for step in leg["steps"]:
            name = step.get("name") or step.get("ref") or ""
            if name and (not roads or roads[-1] != name):
                roads.append(name)
    main_roads = roads[:12]

    text = (
        f"Itinéraire {origin} → {destination} ({mode}) :\n"
        f"Distance : {km:.1f} km, durée estimée : {duration}\n"
        f"Par : {', '.join(main_roads) if main_roads else 'routes locales'}"
    )
    # Coordonnées GeoJSON [lon, lat] -> Leaflet [lat, lon]
    coords = [[lat, lon] for lon, lat in route["geometry"]["coordinates"]]
    widget = {
        "widget": "route",
        "data": {
            "origin": start.get("display_name", origin).split(",")[0],
            "destination": end.get("display_name", destination).split(",")[0],
            "mode": mode,
            "km": round(km, 1),
            "duration": duration,
            "coords": coords,
            "start": [float(start["lat"]), float(start["lon"])],
            "end": [float(end["lat"]), float(end["lon"])],
        },
    }
    return text, widget


ROUTE_TOOL_DEFINITION = {
    "type": "function",
    "function": {
        "name": "get_route",
        "description": "Calcule un itinéraire entre deux lieux (adresses ou villes) avec distance, durée et carte.",
        "parameters": {
            "type": "object",
            "properties": {
                "origin": {"type": "string", "description": "Lieu de départ (ville ou adresse)"},
                "destination": {"type": "string", "description": "Lieu d'arrivée"},
                "mode": {
                    "type": "string",
                    "enum": ["voiture", "velo", "pieton"],
                    "description": "Mode de transport, défaut voiture",
                },
            },
            "required": ["origin", "destination"],
        },
    },
}
