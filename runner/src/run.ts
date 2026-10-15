// One measured run, following the experiment protocol:
//   fresh DB (from template) → restart API → health check → warm-up (not recorded)
//   → k6 run with resource sampling → save artifacts → append a row to results/summary.csv
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendCsv, writeCsv } from './csv.js';
import { durationSeconds } from './catalog.js';
import { API_URL, ROOT, RUNS, SUMMARY_CSV } from './paths.js';
import { CONTAINERS, SAMPLE_COLUMNS, Sampler, type Sample } from './sampler.js';
import { compose, mustCompose, sh, sleep } from './shell.js';
import { round, summarizeSamples } from './stats.js';

export interface RunSpec {
  experiment: string; // experiment id, or "adhoc"
  target: string;
  profile: string;
  rate: number;
  duration: string;
  rep: number;
  warmup?: boolean;
}

export interface RunHooks {
  log: (line: string) => void;
  sample?: (s: Sample) => void;
  aborted?: () => boolean;
}

export const SUMMARY_COLUMNS = [
  'run_id', 'started_at', 'experiment', 'target', 'profile', 'rate', 'duration_s', 'rep',
  'requests', 'achieved_rps', 'achieved_ratio', 'dropped', 'error_rate', 'checks_failed',
  'lat_avg', 'lat_med', 'lat_p90', 'lat_p95', 'lat_p99', 'lat_max',
  'api_cpu_avg', 'api_cpu_max', 'api_mem_avg_mb', 'api_mem_max_mb', 'db_cpu_avg', 'db_cpu_max', 'db_mem_max_mb',
  'k6_cpu_avg', 'k6_cpu_max', 'api_rps_max', 'el_lag_p99_avg_ms', 'el_lag_max_ms', 'pool_waiting_avg',
  'pool_waiting_max', 'heap_max_mb', 'k6_exit', 'other_containers',
];

export class AbortedError extends Error {}

export async function resetDatabase() {
  await mustCompose([
    'exec', '-T', 'db', 'psql', '-q', '-U', 'eventload', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
    '-c', 'DROP DATABASE IF EXISTS eventload WITH (FORCE)',
    '-c', 'CREATE DATABASE eventload TEMPLATE eventload_seed',
  ]);
}

export async function waitForApi(timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(`${API_URL}/api/health`)).ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`API did not become healthy at ${API_URL}`);
}

/** Names of running containers that are not part of this project (they compete for the VM's CPU). */
export async function otherContainers(): Promise<string[]> {
  const r = await sh('docker', ['ps', '--format', '{{.Names}}']);
  return r.stdout.split('\n').filter((n) => n && !n.startsWith('eventload-'));
}

function k6Args(spec: RunSpec, rate: number, profile: string, duration: string, outDir?: string) {
  const env: Record<string, string> = { TARGET: spec.target, PROFILE: profile, RATE: String(rate), DURATION: duration };
  if (outDir) {
    Object.assign(env, {
      OUT_DIR: outDir,
      K6_WEB_DASHBOARD: 'true',
      K6_WEB_DASHBOARD_PERIOD: '2s',
      K6_WEB_DASHBOARD_EXPORT: `${outDir}/k6-report.html`,
    });
  }
  return [
    '--profile', 'tools', 'run', '--rm', '--name', CONTAINERS.k6, ...(outDir ? ['--service-ports'] : []),
    ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    'k6', 'run', '--quiet', '--no-color', 'main.js',
  ];
}

export async function killK6() {
  await sh('docker', ['rm', '-f', CONTAINERS.k6]);
}

export async function runOne(spec: RunSpec, hooks: RunHooks) {
  const check = () => {
    if (hooks.aborted?.()) throw new AbortedError('aborted');
  };
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runId = `${stamp}_${spec.experiment}_${spec.target}_${spec.profile}_${spec.rate}rps_r${spec.rep}`;
  const dir = path.join(RUNS, runId);
  mkdirSync(dir, { recursive: true });
  hooks.log(`▶ ${runId}`);

  const others = await otherContainers();
  if (others.length) hooks.log(`⚠ ${others.length} other containers running (${others.join(', ')}): stop them for final measurements`);

  hooks.log('  resetting database from template, restarting API…');
  await mustCompose(['stop', 'api']);
  await resetDatabase();
  await mustCompose(['start', 'api']);
  await waitForApi();
  check();

  if (spec.warmup !== false && spec.profile !== 'smoke') {
    const warmRate = Math.min(Math.max(5, Math.round(spec.rate * 0.1)), 500);
    hooks.log(`  warm-up: ${warmRate} req/s for 10 s (not recorded)`);
    await compose(k6Args(spec, warmRate, 'warmup', '10s'));
    check();
  }

  const sampler = new Sampler(hooks.sample);
  await sampler.start();
  hooks.log(`  measuring: ${spec.profile} @ ${spec.rate} req/s for ${spec.duration}  (live k6 dashboard: http://localhost:5665)`);
  let warnings = 0;
  const k6 = await compose(k6Args(spec, spec.rate, spec.profile, spec.duration, `/results/runs/${runId}`), (line) => {
    if (/level=warn/.test(line)) warnings++;
    else if (line.trim()) hooks.log(`  k6 │ ${line}`);
  });
  const samples = sampler.stop();
  if (warnings) hooks.log(`  k6 printed ${warnings} request warnings (timeouts / connection errors)`);
  check();

  writeCsv(path.join(dir, 'resources.csv'), samples as any, SAMPLE_COLUMNS);
  const apiLog = await compose(['logs', '--no-color', '--since', startedAt.toISOString(), 'api']);
  writeFileSync(path.join(dir, 'api.log'), apiLog.stdout + apiLog.stderr);

  // 0 = ok, 99 = thresholds crossed (expected for breakpoint runs); anything else is a broken run.
  if (![0, 99].includes(k6.code)) {
    const reason = (k6.stdout + k6.stderr).split('\n').find((l) => /level=error/.test(l)) ?? `exit code ${k6.code}`;
    throw new Error(`k6 failed, run not recorded: ${reason.slice(0, 400)}`);
  }
  const summaryFile = path.join(dir, 'k6-summary.json');
  if (!existsSync(summaryFile)) throw new Error(`k6 produced no summary (exit ${k6.code}):\n${k6.stderr.slice(-2000)}`);
  const m = JSON.parse(readFileSync(summaryFile, 'utf8')).metrics;
  const d = m.http_req_duration?.values ?? {};
  const durationS = durationSeconds(spec.duration);
  const achieved = m.http_reqs?.values.rate ?? 0;
  const row = {
    run_id: runId,
    started_at: startedAt.toISOString(),
    experiment: spec.experiment,
    target: spec.target,
    profile: spec.profile,
    rate: spec.rate,
    duration_s: durationS,
    rep: spec.rep,
    requests: m.http_reqs?.values.count ?? 0,
    achieved_rps: round(achieved, 1),
    // Only meaningful for constant-rate profiles: share of the offered load actually served.
    achieved_ratio: ['constant', 'soak'].includes(spec.profile) ? round(achieved / spec.rate, 3) : '',
    dropped: m.dropped_iterations?.values.count ?? 0,
    error_rate: round(m.http_req_failed?.values.rate ?? 0, 4),
    checks_failed: m.checks?.values.fails ?? 0,
    lat_avg: round(d.avg),
    lat_med: round(d.med),
    lat_p90: round(d['p(90)']),
    lat_p95: round(d['p(95)']),
    lat_p99: round(d['p(99)']),
    lat_max: round(d.max),
    ...summarizeSamples(samples),
    k6_exit: k6.code,
    other_containers: others.length,
  };
  appendCsv(SUMMARY_CSV, row, SUMMARY_COLUMNS);
  writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ spec, row, environment: environment(others) }, null, 2));
  hooks.log(
    `  ✔ ${row.requests} req, ${row.achieved_rps}/s, p95 ${row.lat_p95} ms, p99 ${row.lat_p99} ms, ` +
      `errors ${(Number(row.error_rate) * 100).toFixed(2)} %, dropped ${row.dropped}, API CPU ${row.api_cpu_avg} %`,
  );
  return row;
}

function environment(others: string[]) {
  const git = (() => {
    try {
      return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return 'uncommitted';
    }
  })();
  return {
    host: { platform: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length, memGb: Math.round(os.totalmem() / 2 ** 30) },
    pinning: {
      api: process.env.API_CPUSET ?? '0', db: process.env.DB_CPUSET ?? '1-2', k6: process.env.K6_CPUSET ?? '4-7',
      apiMem: process.env.API_MEM ?? '512m', dbMem: process.env.DB_MEM ?? '2g', poolSize: process.env.POOL_SIZE ?? '10',
    },
    git,
    otherContainers: others,
  };
}
