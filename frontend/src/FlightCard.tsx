export type FlightData = {
  origin: string;
  destination: string;
  date: string;
  flights: {
    price: string;
    currency: string;
    carrier: string;
    departure: string;
    arrival: string;
    from: string;
    to: string;
    stops: number;
    duration: string;
  }[];
};

export function FlightCard({ data }: { data: FlightData }) {
  return (
    <div className="flight-card">
      <div className="flight-header">
        ✈️ {data.origin} → {data.destination} · {data.date}
      </div>
      {data.flights.map((f, i) => (
        <div key={i} className="flight-row">
          <span className="flight-carrier">{f.carrier}</span>
          <span className="flight-times">
            {f.departure.slice(11, 16)} → {f.arrival.slice(11, 16)}
          </span>
          <span className="flight-stops">
            {f.stops === 0 ? "direct" : `${f.stops} esc.`} · {f.duration}
          </span>
          <span className="flight-price">
            {Math.round(Number(f.price))} {f.currency === "EUR" ? "€" : f.currency}
          </span>
        </div>
      ))}
    </div>
  );
}
