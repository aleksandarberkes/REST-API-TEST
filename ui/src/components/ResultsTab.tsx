import { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, ErrorBar, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api, type Catalog, type Group, type Report, type Sample, type SummaryRow } from '../lib/api';
import { COLORS, fmtNum, PALETTE } from '../lib/format';
import { axisProps, ChartCard, gridProps, legendProps, tooltipProps } from './ChartCard';
import { SampleCharts } from './SampleCharts';

export function ResultsTab({ catalog, version }: { catalog: Catalog; version: number }) {
  const [all, setAll] = useState<Report | null>(null);
  const [experiment, setExperiment] = useState('');
  const [logScale, setLogScale] = useState(true);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);

  useEffect(() => {
    api.results().then(setAll).catch(() => setAll({ rows: [], groups: [], knees: {} }));
  }, [version]);

  const experiments = useMemo(() => [...new Set(all?.rows.map((r) => String(r.experiment)))].sort(), [all]);
  useEffect(() => {
    if (!experiment && experiments.length) setExperiment(experiments.find((e) => e !== 'adhoc') ?? experiments[0]);
  }, [experiments, experiment]);

  if (!all) return <p className="hint">Loading…</p>;
  if (!all.rows.length)
    return (
      <div className="card max-w-xl">
        <h3 className="font-semibold">No results yet</h3>
        <p className="hint mt-1">Run an experiment (or a pilot) from the Scenarios tab, or from the terminal: <code>npm run lt -- experiment E1</code></p>
      </div>
    );

  const groups = all.groups.filter((g) => g.experiment === experiment);
  const rows = all.rows.filter((r) => r.experiment === experiment).reverse();
  const exp = catalog.experiments.find((e) => e.id === experiment);
  const knees = Object.entries(all.knees).filter(([k]) => k.startsWith(`${experiment}|`));
  const byTarget = Map.groupBy(groups, (g) => g.target);
  const rateMode = [...byTarget.values()].some((gs) => new Set(gs.map((g) => g.rate)).size > 1);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="label max-w-xs">
          Experiment
          <select className="field" value={experiment} onChange={(e) => { setExperiment(e.target.value); setSelectedRun(null); }}>
            {experiments.map((e) => (
              <option key={e} value={e}>{e === 'adhoc' ? 'Ad-hoc runs' : `${e}: ${catalog.experiments.find((x) => x.id === e)?.title ?? ''}`}</option>
            ))}
          </select>
        </label>
        {rateMode && (
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={logScale} onChange={(e) => setLogScale(e.target.checked)} /> log latency axis
          </label>
        )}
        <div className="ml-auto flex gap-2 pb-0.5">
          <a className="btn" href="/api/files/summary.csv" download>summary.csv</a>
          <a className="btn" href="/api/files/aggregate.csv" download>aggregate.csv</a>
        </div>
      </div>

      {exp && (
        <div className="card text-sm">
          <p><b>Question:</b> {exp.question}</p>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400"><b>Hypothesis:</b> {exp.hypothesis}</p>
        </div>
      )}

      {knees.map(([key, knee]) => (
        <div key={key} className="rounded-lg border-l-4 border-amber-500 bg-amber-50 px-4 py-2.5 text-sm dark:bg-amber-950/40">
          <b>{key.split('|')[1]}</b>:{' '}
          {knee ? <>degradation knee at <b>{knee.rate} req/s</b> ({knee.reason})</> : 'no knee within the measured range'}
        </div>
      ))}

      {rateMode ? <RateCharts byTarget={byTarget} knees={all.knees} experiment={experiment} logScale={logScale} />
        : <TargetCharts groups={groups} />}

      <p className="hint">
        Points are means over repetitions; error bars show the 95 % confidence interval (Student t). n = number of repetitions per point.
      </p>

      <RunsTable rows={rows} selected={selectedRun} onSelect={setSelectedRun} />
      {selectedRun && <RunTimeline runId={selectedRun} />}
    </div>
  );
}

const m = (g: Group | undefined, metric: string, scale = 1) => (g ? g.stats[metric].mean * scale : undefined);
/**
 * Error bar as [below, above]. The lower arm is clipped so the bar never goes under 0 (or, for a log axis,
 * never reaches 0): with few repetitions the 95 % CI can be wider than the mean itself.
 */
const ci = (g: Group | undefined, metric: string, scale = 1): [number, number] | undefined => {
  if (!g) return undefined;
  const { mean, ci95 } = g.stats[metric];
  return [Math.min(ci95, mean * 0.9) * scale, ci95 * scale];
};

function RateCharts({ byTarget, knees, experiment, logScale }: {
  byTarget: Map<string, Group[]>; knees: Report['knees']; experiment: string; logScale: boolean;
}) {
  const targets = [...byTarget.keys()];
  const single = targets.length === 1;
  const rates = [...new Set([...byTarget.values()].flat().map((g) => g.rate))].sort((a, b) => a - b);
  const data = rates.map((rate) => {
    const row: Record<string, number | [number, number] | undefined> = { rate, ideal: rate };
    for (const t of targets) {
      const g = byTarget.get(t)!.find((x) => x.rate === rate);
      row[`${t}.med`] = m(g, 'lat_med');
      row[`${t}.p95`] = m(g, 'lat_p95');
      row[`${t}.p95ci`] = ci(g, 'lat_p95');
      row[`${t}.p99`] = m(g, 'lat_p99');
      row[`${t}.p99ci`] = ci(g, 'lat_p99');
      row[`${t}.rps`] = m(g, 'achieved_rps');
      row[`${t}.rpsci`] = ci(g, 'achieved_rps');
      row[`${t}.api`] = m(g, 'api_cpu_avg');
      row[`${t}.apici`] = ci(g, 'api_cpu_avg');
      row[`${t}.db`] = m(g, 'db_cpu_avg');
      row[`${t}.k6`] = m(g, 'k6_cpu_avg');
      row[`${t}.err`] = m(g, 'error_rate', 100);
      row[`${t}.dropped`] = m(g, 'dropped');
      row[`${t}.lag`] = m(g, 'el_lag_p99_avg_ms');
      row[`${t}.pool`] = m(g, 'pool_waiting_max');
      row[`${t}.mem`] = m(g, 'api_mem_max_mb');
    }
    return row;
  });
  const color = (i: number) => PALETTE[i % PALETTE.length];
  const kneeLines = targets.map((t, i) => {
    const k = knees[`${experiment}|${t}`];
    return k ? <ReferenceLine key={t} x={k.rate} stroke={single ? COLORS.danger : color(i)} strokeDasharray="4 4" label={{ value: 'knee', fill: '#71717a', fontSize: 11, position: 'insideTopRight' }} /> : null;
  });
  const line = (key: string, name: string, stroke: string, ciKey?: string, extra: object = {}) => (
    <Line key={key} dataKey={key} name={name} stroke={stroke} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} connectNulls {...extra}>
      {ciKey && <ErrorBar dataKey={ciKey} width={4} stroke={stroke} strokeOpacity={0.6} />}
    </Line>
  );
  const chart = (lines: React.ReactNode, yProps: object = {}, rightAxis = false) => (
    <ResponsiveContainer>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="rate" {...axisProps} label={{ value: 'offered req/s', position: 'insideBottomRight', offset: -2, fill: '#71717a', fontSize: 11 }} />
        <YAxis {...axisProps} {...yProps} />
        {rightAxis && <YAxis yAxisId="right" orientation="right" {...axisProps} />}
        <Tooltip {...tooltipProps} labelFormatter={(r) => `${r} req/s offered`} formatter={(v) => fmtNum(v, 2)} />
        <Legend {...legendProps} />
        {kneeLines}
        {lines}
      </LineChart>
    </ResponsiveContainer>
  );
  const latencyAxis = logScale ? { scale: 'log', domain: ['auto', 'auto'] } : { domain: [0, 'auto'] };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Latency vs offered load" subtitle={single ? 'median, p95, p99 (ms) as measured by k6' : 'p95 (ms) per endpoint'}>
        {chart(single
          ? [line(`${targets[0]}.med`, 'median', COLORS.p50), line(`${targets[0]}.p95`, 'p95', COLORS.p95, `${targets[0]}.p95ci`), line(`${targets[0]}.p99`, 'p99', COLORS.p99, `${targets[0]}.p99ci`)]
          : targets.map((t, i) => line(`${t}.p95`, t, color(i), `${t}.p95ci`)), { unit: ' ms', ...latencyAxis })}
      </ChartCard>
      <ChartCard title="Throughput: achieved vs offered" subtitle="On the dashed line the API serves everything it is offered. Below it, it can't keep up.">
        {chart([
          line('ideal', 'offered (ideal)', COLORS.ideal, undefined, { strokeDasharray: '5 5', dot: false, strokeWidth: 1.5 }),
          ...targets.map((t, i) => line(`${t}.rps`, single ? 'achieved' : t, single ? COLORS.api : color(i), `${t}.rpsci`)),
        ])}
      </ChartCard>
      <ChartCard title="CPU usage (average during the run)" subtitle="100 % = one core. API is pinned to 1 core, PostgreSQL to 2, k6 to 4.">
        {chart(single
          ? [line(`${targets[0]}.api`, 'API', COLORS.api, `${targets[0]}.apici`), line(`${targets[0]}.db`, 'PostgreSQL', COLORS.db), line(`${targets[0]}.k6`, 'k6 (generator)', COLORS.k6)]
          : targets.map((t, i) => line(`${t}.api`, `${t} API`, color(i))), { unit: '%' })}
      </ChartCard>
      <ChartCard title="Errors and dropped iterations" subtitle="Failed requests (%) · iterations k6 could not start because responses were too slow">
        {chart([
          ...targets.map((t, i) => line(`${t}.err`, single ? 'errors %' : `${t} errors %`, single ? COLORS.danger : color(i))),
          ...targets.map((t, i) => line(`${t}.dropped`, single ? 'dropped' : `${t} dropped`, single ? COLORS.k6 : color(i), undefined, { yAxisId: 'right', strokeDasharray: '4 3' })),
        ], {}, true)}
      </ChartCard>
      <ChartCard title="Event-loop lag & DB pool queue" subtitle="p99 lag of the Node event loop (ms) · max requests waiting for a pooled DB connection">
        {chart([
          ...targets.map((t, i) => line(`${t}.lag`, single ? 'loop lag p99 ms' : `${t} lag`, single ? COLORS.p99 : color(i))),
          ...targets.map((t, i) => line(`${t}.pool`, single ? 'pool waiting (max)' : `${t} pool`, single ? COLORS.db : color(i), undefined, { yAxisId: 'right', strokeDasharray: '4 3' })),
        ], {}, true)}
      </ChartCard>
      <ChartCard title="API memory (max RSS of the container)" subtitle="MiB">
        {chart(targets.map((t, i) => line(`${t}.mem`, single ? 'API memory' : t, single ? COLORS.k6 : color(i))), { unit: ' MiB' })}
      </ChartCard>
    </div>
  );
}

function TargetCharts({ groups }: { groups: Group[] }) {
  const data = groups.map((g) => ({
    name: groups.filter((x) => x.target === g.target).length > 1 ? `${g.target} @${g.rate}` : g.target,
    med: m(g, 'lat_med'), p95: m(g, 'lat_p95'), p95ci: ci(g, 'lat_p95'), p99: m(g, 'lat_p99'), p99ci: ci(g, 'lat_p99'),
    api: m(g, 'api_cpu_avg'), apici: ci(g, 'api_cpu_avg'), db: m(g, 'db_cpu_avg'), dbci: ci(g, 'db_cpu_avg'), k6: m(g, 'k6_cpu_avg'),
    rps: m(g, 'achieved_rps'), rpsmax: m(g, 'api_rps_max'),
    err: m(g, 'error_rate', 100), lag: m(g, 'el_lag_p99_avg_ms'), pool: m(g, 'pool_waiting_max'),
  }));
  const bars = (items: [string, string, string, string?][], unit?: string) => (
    <ResponsiveContainer>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 30, left: 0 }}>
        <CartesianGrid {...gridProps} vertical={false} />
        <XAxis dataKey="name" {...axisProps} angle={-25} textAnchor="end" interval={0} height={50} />
        <YAxis {...axisProps} unit={unit} />
        <Tooltip {...tooltipProps} formatter={(v) => fmtNum(v, 2)} cursor={{ fill: '#a1a1aa', fillOpacity: 0.1 }} />
        <Legend {...legendProps} verticalAlign="top" />
        {items.map(([key, name, fill, ciKey]) => (
          <Bar key={key} dataKey={key} name={name} fill={fill} radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {ciKey && <ErrorBar dataKey={ciKey} width={4} stroke="#52525b" />}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Latency per scenario" subtitle="median / p95 / p99 (ms)">
        {bars([['med', 'median', COLORS.p50], ['p95', 'p95', COLORS.p95, 'p95ci'], ['p99', 'p99', COLORS.p99, 'p99ci']], ' ms')}
      </ChartCard>
      <ChartCard title="Which resource works hardest" subtitle="Average CPU % (100 = one core). This shows where the bottleneck is.">
        {bars([['api', 'API', COLORS.api, 'apici'], ['db', 'PostgreSQL', COLORS.db, 'dbci'], ['k6', 'k6', COLORS.k6]], '%')}
      </ChartCard>
      <ChartCard title="Throughput" subtitle="Achieved average req/s (k6) · highest per-second rate served by the API (breaking point for breakpoint runs)">
        {bars([['rps', 'achieved avg', COLORS.api], ['rpsmax', 'max served /s', COLORS.p95]])}
      </ChartCard>
      <ChartCard title="Errors, event-loop lag, pool queue" subtitle="errors % · loop lag p99 (ms) · max requests waiting for a DB connection">
        {bars([['err', 'errors %', COLORS.danger], ['lag', 'loop lag ms', COLORS.p99], ['pool', 'pool waiting', COLORS.db]])}
      </ChartCard>
    </div>
  );
}

function RunsTable({ rows, selected, onSelect }: { rows: SummaryRow[]; selected: string | null; onSelect: (id: string) => void }) {
  const cols: [string, string, number?][] = [
    ['target', 'Endpoint'], ['profile', 'Profile'], ['rate', 'Rate'], ['rep', 'Rep'], ['achieved_rps', 'Achieved/s', 1],
    ['lat_med', 'Median ms', 2], ['lat_p95', 'p95 ms', 2], ['lat_p99', 'p99 ms', 2], ['error_rate', 'Errors %'],
    ['dropped', 'Dropped', 0], ['api_cpu_avg', 'API CPU %', 1], ['db_cpu_avg', 'DB CPU %', 1], ['k6_cpu_avg', 'k6 CPU %', 1],
    ['el_lag_p99_avg_ms', 'Lag p99 ms', 2], ['pool_waiting_max', 'Pool wait', 0],
  ];
  return (
    <div className="card">
      <h4 className="text-sm font-semibold">Runs <span className="hint font-normal">· click a row to see its per-second timeline</span></h4>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
              <th className="px-2 py-1.5 text-left font-medium">Started</th>
              {cols.map(([key, label]) => (
                <th key={label} className={`px-2 py-1.5 font-medium ${key === 'target' || key === 'profile' ? 'text-left' : 'text-right'}`}>{label}</th>
              ))}
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const id = String(r.run_id);
              return (
                <tr key={id} onClick={() => onSelect(id)}
                  className={`cursor-pointer border-b border-zinc-100 tabular-nums hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/50 ${selected === id ? 'bg-blue-50 dark:bg-blue-950/40' : ''}`}>
                  <td className="px-2 py-1.5 whitespace-nowrap text-zinc-500">{String(r.started_at).slice(5, 16).replace('T', ' ')}</td>
                  {cols.map(([key, , digits]) => (
                    <td key={key} className={`px-2 py-1.5 whitespace-nowrap ${typeof r[key] === 'number' ? 'text-right' : 'text-left'}`}>
                      {key === 'error_rate' ? fmtNum(Number(r[key]) * 100, 2) : digits === undefined ? String(r[key]) : fmtNum(r[key], digits)}
                    </td>
                  ))}
                  <td className="px-2 py-1.5">
                    <a href={`/runs/${id}/k6-report.html`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                      className="text-blue-600 hover:underline dark:text-blue-400">k6 report</a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RunTimeline({ runId }: { runId: string }) {
  const [samples, setSamples] = useState<Sample[] | null>(null);
  useEffect(() => {
    setSamples(null);
    api.resources(runId).then(setSamples).catch(() => setSamples([]));
  }, [runId]);
  return (
    <div className="space-y-3">
      <h3 className="font-semibold">Timeline <span className="hint font-mono font-normal">{runId}</span></h3>
      {samples ? <SampleCharts samples={samples} /> : <p className="hint">Loading…</p>}
    </div>
  );
}
