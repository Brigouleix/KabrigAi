export type ChartData = {
  title: string;
  labels: string[];
  series: { name: string; values: number[] }[];
  type?: "line" | "bar";
};

const COLORS = ["#f0a05a", "#5a8df0", "#34a872", "#d65745", "#9b6dd6"];
const W = 480;
const H = 220;
const PAD = { left: 52, right: 12, top: 14, bottom: 26 };

export function ChartCard({ data }: { data: ChartData }) {
  const all = data.series.flatMap((s) => s.values);
  if (!all.length) return null;
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  min -= span * 0.05;
  max += span * 0.05;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number, n: number) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - ((v - min) / (max - min)) * plotH;

  const fmt = (v: number) =>
    Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(Math.abs(v) < 10 ? 2 : 0);

  const n = data.labels.length;
  const xticks = n > 2 ? [0, Math.floor(n / 2), n - 1] : [0, n - 1];
  const yticks = [min + (max - min) * 0.05, (min + max) / 2, max - (max - min) * 0.05];

  return (
    <div className="chart-card">
      <div className="chart-title">{data.title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
        {yticks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="chart-grid" />
            <text x={PAD.left - 6} y={y(v) + 4} className="chart-tick" textAnchor="end">
              {fmt(v)}
            </text>
          </g>
        ))}
        {xticks.map((i) => (
          <text key={i} x={x(i, n)} y={H - 8} className="chart-tick" textAnchor="middle">
            {data.labels[i]}
          </text>
        ))}
        {data.type === "bar"
          ? data.series.slice(0, 1).map((s) =>
              s.values.map((v, i) => {
                const bw = Math.max(2, (plotW / s.values.length) * 0.7);
                return (
                  <rect
                    key={i}
                    x={x(i, s.values.length) - bw / 2}
                    y={y(Math.max(v, 0))}
                    width={bw}
                    height={Math.abs(y(v) - y(Math.max(min, 0) > 0 ? min : 0))}
                    fill={COLORS[0]}
                    rx={2}
                  />
                );
              })
            )
          : data.series.map((s, si) => (
              <polyline
                key={s.name}
                points={s.values.map((v, i) => `${x(i, s.values.length)},${y(v)}`).join(" ")}
                fill="none"
                stroke={COLORS[si % COLORS.length]}
                strokeWidth={2}
              />
            ))}
      </svg>
      {data.series.length > 1 && (
        <div className="chart-legend">
          {data.series.map((s, i) => (
            <span key={s.name}>
              <i style={{ background: COLORS[i % COLORS.length] }} /> {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
