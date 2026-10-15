import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Sample } from '../lib/api';
import { COLORS } from '../lib/format';
import { axisProps, ChartCard, gridProps, legendProps, tooltipProps } from './ChartCard';

/** Per-second resource charts: used live on the Run tab and for a finished run's timeline. */
export function SampleCharts({ samples, live }: { samples: Sample[]; live?: boolean }) {
  const line = (key: keyof Sample, name: string, color: string, yAxisId?: string) => (
    <Line key={key} dataKey={key} name={name} stroke={color} dot={false} strokeWidth={2} isAnimationActive={false} connectNulls yAxisId={yAxisId} />
  );
  const chart = (lines: React.ReactNode[], unit?: string, rightAxis?: boolean) => (
    <ResponsiveContainer>
      <LineChart data={samples} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="t" {...axisProps} unit="s" />
        <YAxis {...axisProps} unit={unit} />
        {rightAxis && <YAxis yAxisId="right" orientation="right" {...axisProps} allowDecimals={false} />}
        <Tooltip {...tooltipProps} labelFormatter={(t) => `t = ${t} s`} />
        <Legend {...legendProps} />
        {lines}
      </LineChart>
    </ResponsiveContainer>
  );
  const sub = live ? 'live, 1 sample per second' : undefined;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Served requests per second" subtitle={sub ?? 'counted inside the API'}>
        {chart([line('api_rps', 'API req/s', COLORS.api)])}
      </ChartCard>
      <ChartCard title="CPU usage" subtitle="100 % = one full core. The API is pinned to 1 core, so 100 % means saturated.">
        {chart([line('api_cpu', 'API', COLORS.api), line('db_cpu', 'PostgreSQL', COLORS.db), line('k6_cpu', 'k6', COLORS.k6)], '%')}
      </ChartCard>
      <ChartCard title="Event-loop lag p99 & pool queue" subtitle="Lag = how late Node runs its callbacks. Pool waiting = requests queued for a DB connection.">
        {chart([line('el_lag_p99_ms', 'loop lag p99 (ms)', COLORS.p99), line('pool_waiting', 'pool waiting', COLORS.db, 'right')], undefined, true)}
      </ChartCard>
      <ChartCard title="Server-side latency & memory" subtitle="Average time inside Express (ms) · API container memory (MiB)">
        {chart([line('api_avg_ms', 'avg ms', COLORS.p95), line('api_mem_mb', 'API MiB', COLORS.k6, 'right')], undefined, true)}
      </ChartCard>
    </div>
  );
}
