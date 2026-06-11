export type WeatherData = {
  city: string;
  country: string;
  temp: number;
  feels?: number;
  desc: string;
  code: number;
  wind: number;
  gusts?: number;
  humidity: number;
  uv?: number;
  sunrise?: string;
  sunset?: string;
  tips?: string[];
  days: {
    date: string;
    min: number;
    max: number;
    code: number;
    desc: string;
    rain?: number | null;
  }[];
};

function icon(code: number): string {
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤️";
  if (code === 3) return "☁️";
  if (code <= 48) return "🌫️";
  if (code <= 55) return "🌦️";
  if (code <= 65) return "🌧️";
  if (code <= 75) return "🌨️";
  if (code <= 82) return "🌧️";
  return "⛈️";
}

function dayLabel(date: string): string {
  return new Date(date).toLocaleDateString("fr-FR", { weekday: "short" });
}

export function WeatherCard({ data }: { data: WeatherData }) {
  return (
    <div className="weather-card">
      <div className="weather-now">
        <span className="weather-icon">{icon(data.code)}</span>
        <div>
          <div className="weather-temp">{Math.round(data.temp)}°C</div>
          <div className="weather-city">
            {data.city}, {data.country}
          </div>
          <div className="weather-desc">{data.desc}</div>
        </div>
      </div>

      <div className="weather-grid">
        {data.feels != null && (
          <span title="Température ressentie">🌡️ Ressenti {Math.round(data.feels)}°</span>
        )}
        <span title="Vent (rafales)">
          💨 {Math.round(data.wind)}
          {data.gusts != null && ` (${Math.round(data.gusts)})`} km/h
        </span>
        <span title="Humidité">💧 {data.humidity}%</span>
        {data.uv != null && <span title="Indice UV">😎 UV {Math.round(data.uv)}</span>}
        {data.sunrise && <span title="Lever du soleil">🌅 {data.sunrise}</span>}
        {data.sunset && <span title="Coucher du soleil">🌇 {data.sunset}</span>}
      </div>

      {data.tips && data.tips.length > 0 && (
        <ul className="weather-tips">
          {data.tips.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}

      <div className="weather-days">
        {data.days.map((d) => (
          <div key={d.date} className="weather-day" title={d.desc}>
            <span>{dayLabel(d.date)}</span>
            <span>{icon(d.code)}</span>
            <span className="weather-minmax">
              {Math.round(d.min)}°<em>{Math.round(d.max)}°</em>
            </span>
            {d.rain != null && d.rain > 5 ? (
              <span className="weather-rain">☔ {d.rain}%</span>
            ) : (
              <span className="weather-rain"> </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
