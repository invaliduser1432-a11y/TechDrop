import { useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
export default function PriceChart({
  observations,
  demo,
}: {
  observations: { at: number; total: number }[];
  demo: boolean;
}) {
  const [range, setRange] = useState(30);
  const data = [...observations]
    .filter((o) => o.at >= Date.now() - range * 86400000)
    .sort((a, b) => a.at - b.at)
    .map((o) => ({
      date: new Date(o.at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }),
      price: o.total / 100,
    }));
  return (
    <div>
      <div className="filterbar" style={{ marginBottom: 10 }}>
        {[7, 30, 90].map((n) => (
          <button
            key={n}
            className={`chip ${range === n ? 'active' : ''}`}
            onClick={() => setRange(n)}
          >
            {n} days
          </button>
        ))}
        <span className="small">
          {demo ? 'Simulated observations' : 'Recorded observations'} · total including known
          shipping
        </span>
      </div>
      <div className="chart-wrap" role="img" aria-label="Observed total price over time">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 15, right: 15, bottom: 5, left: 0 }}>
            <defs>
              <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#149bb8" stopOpacity={0.2} />
                <stop offset="1" stopColor="#149bb8" stopOpacity={0.015} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 4" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: 'var(--muted)' }}
              axisLine={false}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              tickFormatter={(v) => `$${v}`}
              tick={{ fontSize: 10, fill: 'var(--muted)' }}
              axisLine={false}
              tickLine={false}
              domain={['dataMin - 10', 'dataMax + 10']}
            />
            <Tooltip
              formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Observed total']}
              contentStyle={{
                border: '1px solid var(--line)',
                borderRadius: 8,
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: 12,
              }}
            />
            <Area
              type="stepAfter"
              dataKey="price"
              stroke="#149bb8"
              strokeWidth={2.5}
              fill="url(#priceFill)"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
