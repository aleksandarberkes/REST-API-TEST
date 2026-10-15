// Samples resource usage once per second while a k6 run is in progress:
//  - `docker stats` stream → CPU % (100 % = one full core) and memory of api, db and k6 containers
//  - GET /internal/metrics on the API → served req/s, server-side latency, event-loop lag, pg pool
import { spawn, type ChildProcess } from 'node:child_process';
import { API_URL } from './paths.js';

export interface Sample {
  t: number; // seconds since sampling started
  api_cpu: number;
  api_mem_mb: number;
  db_cpu: number;
  db_mem_mb: number;
  k6_cpu: number;
  k6_mem_mb: number;
  api_rps: number;
  api_avg_ms: number;
  api_5xx: number;
  el_lag_p99_ms: number;
  el_lag_max_ms: number;
  pool_total: number;
  pool_waiting: number;
  heap_mb: number;
}

export const SAMPLE_COLUMNS: (keyof Sample)[] = [
  't', 'api_cpu', 'api_mem_mb', 'db_cpu', 'db_mem_mb', 'k6_cpu', 'k6_mem_mb', 'api_rps', 'api_avg_ms',
  'api_5xx', 'el_lag_p99_ms', 'el_lag_max_ms', 'pool_total', 'pool_waiting', 'heap_mb',
];

export const CONTAINERS = { api: 'eventload-api-1', db: 'eventload-db-1', k6: 'eventload-k6' } as const;

const UNITS: Record<string, number> = {
  B: 1 / 2 ** 20, KiB: 1 / 1024, MiB: 1, GiB: 1024, kB: 1e3 / 2 ** 20, MB: 1e6 / 2 ** 20, GB: 1e9 / 2 ** 20,
};

/** Parses "50.1MiB / 512MiB" → 50.1 (MiB used). */
export function parseMem(usage: string): number {
  const m = /^([\d.]+)\s*([A-Za-z]+)/.exec(usage.trim());
  if (!m) return 0;
  return +(Number(m[1]) * (UNITS[m[2]] ?? 0)).toFixed(1);
}

/** Parses one line of `docker stats --format '{{json .}}'` (may include ANSI clear-screen codes). */
export function parseStatsLine(line: string): { name: string; cpu: number; mem: number } | null {
  const json = line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim();
  if (!json.startsWith('{')) return null;
  try {
    const s = JSON.parse(json);
    return { name: s.Name, cpu: parseFloat(s.CPUPerc) || 0, mem: parseMem(s.MemUsage ?? '') };
  } catch {
    return null;
  }
}

export class Sampler {
  private stats = new Map<string, { cpu: number; mem: number }>();
  private proc?: ChildProcess;
  private timer?: NodeJS.Timeout;
  private startedAt = 0;
  private lastMetricsAt = 0;
  readonly samples: Sample[] = [];

  constructor(private onSample?: (s: Sample) => void) {}

  async start() {
    this.proc = spawn('docker', ['stats', '--format', '{{json .}}']);
    let buf = '';
    this.proc.stdout!.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const s = parseStatsLine(line);
        if (s) this.stats.set(s.name, { cpu: s.cpu, mem: s.mem });
      }
    });
    // docker stats needs ~2 s for its first reading; don't start the run before it has one.
    for (let i = 0; i < 50 && !this.stats.has(CONTAINERS.api); i++) await new Promise((r) => setTimeout(r, 100));
    await fetchMetrics(); // resets the API's counters so the first sample covers only this run
    this.startedAt = this.lastMetricsAt = Date.now();
    this.timer = setInterval(() => void this.tick(), 1000);
  }

  private async tick() {
    const m = await fetchMetrics();
    // Counters cover the time since the last successful read (a read can time out under saturation).
    const now = Date.now();
    const elapsed = (now - this.lastMetricsAt) / 1000;
    if (m) this.lastMetricsAt = now;
    const missing = Number.NaN;
    const c = (name: string) => this.stats.get(name) ?? { cpu: 0, mem: 0 };
    const sample: Sample = {
      t: Math.round((Date.now() - this.startedAt) / 1000),
      api_cpu: c(CONTAINERS.api).cpu,
      api_mem_mb: c(CONTAINERS.api).mem,
      db_cpu: c(CONTAINERS.db).cpu,
      db_mem_mb: c(CONTAINERS.db).mem,
      k6_cpu: c(CONTAINERS.k6).cpu,
      k6_mem_mb: c(CONTAINERS.k6).mem,
      api_rps: m ? Math.round(m.requests / elapsed) : missing,
      api_avg_ms: m?.avgServerMs ?? missing,
      api_5xx: m?.errors5xx ?? missing,
      el_lag_p99_ms: m?.eventLoopLagMs.p99 ?? missing,
      el_lag_max_ms: m?.eventLoopLagMs.max ?? missing,
      pool_total: m?.pool.total ?? missing,
      pool_waiting: m?.pool.waiting ?? missing,
      heap_mb: m?.memoryMb.heapUsed ?? missing,
    };
    this.samples.push(sample);
    this.onSample?.(sample);
  }

  stop() {
    clearInterval(this.timer);
    this.proc?.kill();
    return this.samples;
  }
}

interface ApiMetrics {
  requests: number;
  errors5xx: number;
  avgServerMs: number;
  eventLoopLagMs: { p99: number; max: number };
  pool: { total: number; waiting: number };
  memoryMb: { heapUsed: number };
}

async function fetchMetrics(): Promise<ApiMetrics | null> {
  try {
    const res = await fetch(`${API_URL}/internal/metrics`, { signal: AbortSignal.timeout(900) });
    return (await res.json()) as ApiMetrics;
  } catch {
    return null; // API saturated or restarting: leave a gap (NaN) rather than stall sampling
  }
}
