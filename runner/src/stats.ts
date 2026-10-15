// Pure statistics helpers (unit-tested in test/stats.test.ts).
import type { Row } from './csv.js';
import type { Sample } from './sampler.js';

const finite = (xs: number[]) => xs.filter((x) => Number.isFinite(x));

export function mean(xs: number[]): number {
  const v = finite(xs);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : Number.NaN;
}

export function max(xs: number[]): number {
  const v = finite(xs);
  return v.length ? Math.max(...v) : Number.NaN;
}

export function median(xs: number[]): number {
  const v = finite(xs).sort((a, b) => a - b);
  if (!v.length) return Number.NaN;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Sample standard deviation (n − 1). */
export function stddev(xs: number[]): number {
  const v = finite(xs);
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1));
}

// Two-sided Student t critical values for 95 % confidence, df = 1..10.
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228];

/** Half-width of the 95 % confidence interval of the mean. */
export function ci95(xs: number[]): number {
  const n = finite(xs).length;
  if (n < 2) return 0;
  const t = n - 1 <= T95.length ? T95[n - 2] : n - 1 < 30 ? 2.09 : 1.96;
  return (t * stddev(xs)) / Math.sqrt(n);
}

export const round = (x: number, d = 2) => (Number.isFinite(x) ? +x.toFixed(d) : '');

/**
 * Keeps only the samples recorded while load was flowing (API served > 0 req/s),
 * dropping one sample at each edge, where a second is only partly covered.
 */
export function activeWindow(samples: Sample[]): Sample[] {
  const first = samples.findIndex((s) => s.api_rps > 0);
  const last = samples.findLastIndex((s) => s.api_rps > 0);
  if (first < 0) return samples;
  const inner = samples.slice(first + 1, last);
  return inner.length >= 3 ? inner : samples.slice(first, last + 1);
}

export function summarizeSamples(samples: Sample[]) {
  const w = activeWindow(samples);
  const col = (k: keyof Sample) => w.map((s) => s[k]);
  return {
    api_cpu_avg: round(mean(col('api_cpu')), 1),
    api_cpu_max: round(max(col('api_cpu')), 1),
    api_mem_avg_mb: round(mean(col('api_mem_mb')), 1),
    api_mem_max_mb: round(max(col('api_mem_mb')), 1),
    db_cpu_avg: round(mean(col('db_cpu')), 1),
    db_cpu_max: round(max(col('db_cpu')), 1),
    db_mem_max_mb: round(max(col('db_mem_mb')), 1),
    k6_cpu_avg: round(mean(col('k6_cpu')), 1),
    k6_cpu_max: round(max(col('k6_cpu')), 1),
    api_rps_max: round(max(col('api_rps')), 0),
    el_lag_p99_avg_ms: round(mean(col('el_lag_p99_ms'))),
    el_lag_max_ms: round(max(col('el_lag_max_ms'))),
    pool_waiting_avg: round(mean(col('pool_waiting')), 1),
    pool_waiting_max: round(max(col('pool_waiting')), 0),
    heap_max_mb: round(max(col('heap_mb')), 1),
  };
}

/** Metrics aggregated across repetitions (mean / sd / ci95). */
export const AGG_METRICS = [
  'achieved_rps', 'achieved_ratio', 'error_rate', 'dropped', 'lat_avg', 'lat_med', 'lat_p95', 'lat_p99',
  'api_cpu_avg', 'api_mem_max_mb', 'db_cpu_avg', 'k6_cpu_avg', 'api_rps_max', 'el_lag_p99_avg_ms',
  'pool_waiting_max',
] as const;

export interface Group {
  experiment: string;
  target: string;
  profile: string;
  rate: number;
  n: number;
  stats: Record<string, { mean: number; sd: number; ci95: number; median: number; min: number; max: number }>;
}

export function aggregate(rows: Row[]): Group[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = [r.experiment, r.target, r.profile, r.rate].join('|');
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()]
    .map((rs) => {
      const stats: Group['stats'] = {};
      for (const m of AGG_METRICS) {
        const xs = rs.map((r) => Number(r[m]));
        stats[m] = {
          mean: mean(xs), sd: stddev(xs), ci95: ci95(xs), median: median(xs),
          min: Math.min(...finite(xs)), max: max(xs),
        };
      }
      const r = rs[0];
      return { experiment: String(r.experiment), target: String(r.target), profile: String(r.profile), rate: Number(r.rate), n: rs.length, stats };
    })
    .sort((a, b) => a.experiment.localeCompare(b.experiment) || a.target.localeCompare(b.target) || a.rate - b.rate);
}

export interface Knee {
  rate: number;
  reason: string;
}

/**
 * Degradation knee for one target over increasing constant rates: the first level where
 *  - achieved throughput falls below 95 % of the offered rate, or
 *  - p95 latency exceeds 3× the baseline (lowest p95 among the first three levels), or
 *  - the error rate exceeds 1 %.
 * Uses the median over repetitions, so one disturbed run cannot move the knee.
 */
export function findKnee(groups: Group[]): Knee | null {
  const g = [...groups].sort((a, b) => a.rate - b.rate);
  if (g.length < 2) return null;
  const baseline = Math.min(...g.slice(0, 3).map((x) => x.stats.lat_p95.median));
  for (const x of g) {
    const s = x.stats;
    if (s.achieved_ratio.median < 0.95)
      return { rate: x.rate, reason: `throughput only ${(s.achieved_ratio.median * 100).toFixed(0)} % of offered` };
    if (s.error_rate.median > 0.01) return { rate: x.rate, reason: `error rate ${(s.error_rate.median * 100).toFixed(1)} %` };
    if (s.lat_p95.median > 3 * baseline)
      return { rate: x.rate, reason: `median p95 ${s.lat_p95.median.toFixed(1)} ms > 3× baseline ${baseline.toFixed(1)} ms` };
  }
  return null;
}
