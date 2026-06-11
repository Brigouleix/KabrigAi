import { CircleMarker, MapContainer, Polyline, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export type RouteData = {
  origin: string;
  destination: string;
  mode: string;
  km: number;
  duration: string;
  coords: [number, number][];
  start: [number, number];
  end: [number, number];
};

const MODE_ICONS: Record<string, string> = {
  voiture: "🚗",
  velo: "🚴",
  pieton: "🚶",
};

export function RouteCard({ data }: { data: RouteData }) {
  const bounds: [number, number][] = [data.start, data.end];
  return (
    <div className="route-card">
      <div className="route-header">
        <span>
          {MODE_ICONS[data.mode] ?? "🗺️"} {data.origin} → {data.destination}
        </span>
        <span className="route-stats">
          {data.km} km · {data.duration}
        </span>
      </div>
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [30, 30] }}
        className="route-map"
        scrollWheelZoom={false}
        attributionControl={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Polyline positions={data.coords} pathOptions={{ color: "#1f6feb", weight: 5 }} />
        <CircleMarker
          center={data.start}
          radius={7}
          pathOptions={{ color: "#fff", fillColor: "#3fb950", fillOpacity: 1, weight: 2 }}
        />
        <CircleMarker
          center={data.end}
          radius={7}
          pathOptions={{ color: "#fff", fillColor: "#f85149", fillOpacity: 1, weight: 2 }}
        />
      </MapContainer>
    </div>
  );
}
