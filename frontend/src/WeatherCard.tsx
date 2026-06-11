export type WeatherData = {
  city: string;
  country: string;
  temp: number;
  desc: string;
  code: number;
  wind: number;
  humidity: number;
  days: { date: string; min: number; max: number; code: number; desc: string }[];
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
        <div className="weather-meta">
          <span>💨 {data.wind} km/h</span>
          <span>💧 {data.humidity}%</span>
        </div>
      </div>
      <div className="weather-days">
        {data.days.map((d) => (
          <div key={d.date} className="weather-day">
            <span>{dayLabel(d.date)}</span>
            <span>{icon(d.code)}</span>
            <span>
              {Math.round(d.min)}° / {Math.round(d.max)}°
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
