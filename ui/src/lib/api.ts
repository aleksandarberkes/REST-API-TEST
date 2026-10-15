// Types mirror runner/src (catalog.ts, sampler.ts, stats.ts, jobs.ts).
export interface Target {
  title: string;
  request: string;
  kind: 'read' | 'write' | 'mix';
  cost?: string;
  mix?: { read: number; write: number };
  description: string;
  why: string;
  expect: string;
}
export interface Profile {
  title: string;
  executor: string;
  defaults: { rate: number; duration: string };
  description: string;
  why: string;
}
export interface Experiment {
  id: string;
  title: string;
  question: string;
  hypothesis: string;
  description: string;
  profile: string;
  targets: string[];
  rates: number[];
  duration: string;
  reps: number;
  xAxis: 'rate' | 'target';
  runs: number;
  estimateSeconds: number;
}
export interface Catalog {
  targets: Record<string, Target>;
  profiles: Record<string, Profile>;
  experiments: Experiment[];
}
export interface Sample {
  t: number;
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
export interface RunSpec {
  experiment: string;
  target: string;
  profile: string;
  rate: number;
  duration: string;
  rep: number;
}
export interface JobStatus {
  id: string;
  label: string;
  state: 'running' | 'done' | 'failed' | 'aborted';
  total: number;
  completed: number;
  current?: RunSpec;
  startedAt: string;
  etaSeconds: number;
  error?: string;
}
export type SummaryRow = Record<string, string | number>;
export interface Stat {
  mean: number;
  sd: number;
  ci95: number;
  median: number;
  min: number;
  max: number;
}
export interface Group {
  experiment: string;
  target: string;
  profile: string;
  rate: number;
  n: number;
  stats: Record<string, Stat>;
}
export interface Report {
  rows: SummaryRow[];
  groups: Group[];
  knees: Record<string, { rate: number; reason: string } | null>;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

export const api = {
  catalog: () => call<Catalog>('/api/catalog'),
  status: () => call<{ status: JobStatus | null; log: string[] }>('/api/status'),
  run: (body: { target: string; profile: string; rate?: number; duration?: string; reps?: number }) =>
    call('/api/run', { method: 'POST', body: JSON.stringify(body) }),
  experiment: (body: { id: string; reps?: number; duration?: string }) =>
    call('/api/experiment', { method: 'POST', body: JSON.stringify(body) }),
  stop: () => call('/api/stop', { method: 'POST' }),
  results: (experiment?: string) =>
    call<Report>(`/api/results${experiment ? `?experiment=${encodeURIComponent(experiment)}` : ''}`),
  resources: (runId: string) => call<Sample[]>(`/api/runs/${encodeURIComponent(runId)}/resources`),
};
