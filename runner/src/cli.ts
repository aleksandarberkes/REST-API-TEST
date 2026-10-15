#!/usr/bin/env tsx
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { loadCatalog } from './catalog.js';
import { experimentById, Job, planExperiment, estimateSeconds } from './jobs.js';
import { AGGREGATE_CSV, ROOT, SUMMARY_CSV } from './paths.js';
import { buildReport, writeAggregateCsv } from './report.js';
import { otherContainers, resetDatabase, waitForApi } from './run.js';
import { mustCompose } from './shell.js';
import { round } from './stats.js';

const envFile = path.join(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const program = new Command('lt').description('EventLoad load-testing lab');
const minutes = (s: number) => `${Math.round(s / 60)} min`;

program
  .command('setup')
  .description('start Postgres, create + seed the template DB, build and start the API')
  .action(async () => {
    const log = (l: string) => console.log(`  ${l}`);
    console.log('starting PostgreSQL…');
    await mustCompose(['up', '-d', '--wait', 'db']);
    console.log('creating template database eventload_seed (schema + deterministic seed)…');
    await mustCompose(['exec', '-T', 'db', 'psql', '-q', '-U', 'eventload', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
      '-c', 'DROP DATABASE IF EXISTS eventload_seed WITH (FORCE)', '-c', 'CREATE DATABASE eventload_seed']);
    await mustCompose(['exec', '-T', 'db', 'psql', '-q', '-U', 'eventload', '-d', 'eventload_seed', '-v', 'ON_ERROR_STOP=1',
      '-f', '/db/schema.sql', '-f', '/db/seed.sql']);
    await resetDatabase();
    console.log('building and starting the API container…');
    await mustCompose(['up', '-d', '--build', 'api'], log);
    console.log('pulling k6 image…');
    await mustCompose(['--profile', 'tools', 'pull', 'k6']);
    await waitForApi();
    console.log('\n✔ ready. API: http://localhost:3000/docs   Next: npm run lt -- list');
  });

program
  .command('list')
  .description('show all targets, load profiles and experiments with explanations')
  .action(() => {
    const c = loadCatalog();
    const wrap = (s: string) => s.replace(/(.{1,92})(\s|$)/g, '      $1\n').trimEnd();
    console.log('\nTARGETS (endpoints)\n');
    for (const [id, t] of Object.entries(c.targets))
      console.log(`  ${id.padEnd(20)} ${t.request}\n${wrap(t.description)}\n${wrap('Why: ' + t.why)}\n`);
    console.log('LOAD PROFILES\n');
    for (const [id, p] of Object.entries(c.profiles))
      console.log(`  ${id.padEnd(12)} ${p.title} (default ${p.defaults.rate}/s, ${p.defaults.duration})\n${wrap(p.description)}\n${wrap('Why: ' + p.why)}\n`);
    console.log('EXPERIMENTS\n');
    for (const e of c.experiments) {
      const runs = planExperiment(e);
      console.log(`  ${e.id}  ${e.title}\n${wrap('Q: ' + e.question)}\n${wrap('H: ' + e.hypothesis)}`);
      console.log(`      ${e.targets.join(', ')} × [${e.rates.join(', ')}] req/s × ${e.reps} reps, ${e.profile} ${e.duration}` +
        ` → ${runs.length} runs, ~${minutes(estimateSeconds(runs))}\n`);
    }
  });

async function runJob(job: Job) {
  const others = await otherContainers();
  if (others.length)
    console.log(`\n⚠  ${others.length} unrelated containers are running in Docker. They share CPU with the test.\n   Stop them for final measurements: docker stop ${others.join(' ')}\n`);
  console.log(`${job.label}: ${job.runs.length} run(s), estimated ${minutes(job.status.etaSeconds)}\n`);
  job.on('log', (l: string) => console.log(l));
  let aborting = false;
  process.on('SIGINT', () => {
    if (aborting) process.exit(130);
    aborting = true;
    console.log('\nstopping after cleanup… (Ctrl+C again to force)');
    void job.abort();
  });
  const status = await job.start();
  console.log(`\n${status.state}: ${status.completed}/${status.total} runs → ${path.relative(process.cwd(), SUMMARY_CSV)}`);
  process.exit(status.state === 'done' ? 0 : 1);
}

program
  .command('run <target>')
  .description('one ad-hoc run (or several with --reps / several --rate values)')
  .option('-p, --profile <profile>', 'load profile', 'constant')
  .option('-r, --rate <rates>', 'req/s, comma-separated for several levels')
  .option('-d, --duration <duration>', 'e.g. 30s, 2m')
  .option('-n, --reps <n>', 'repetitions', '1')
  .option('--no-warmup', 'skip the 10 s warm-up')
  .action(async (target: string, o) => {
    const c = loadCatalog();
    if (!c.targets[target]) throw new Error(`unknown target ${target}. See: npm run lt -- list`);
    const profile = c.profiles[o.profile];
    if (!profile) throw new Error(`unknown profile ${o.profile}`);
    const rates = String(o.rate ?? profile.defaults.rate).split(',').map(Number);
    const runs = [];
    for (let rep = 1; rep <= Number(o.reps); rep++)
      for (const rate of rates)
        runs.push({ experiment: 'adhoc', target, profile: o.profile, rate, duration: o.duration ?? profile.defaults.duration, rep, warmup: o.warmup });
    await runJob(new Job(`${target} / ${o.profile}`, runs));
  });

program
  .command('experiment <id>')
  .description('run a predefined experiment (E1…E6) with the full protocol')
  .option('-n, --reps <n>', 'override repetitions')
  .option('-d, --duration <duration>', 'override duration per run (e.g. 15s for a pilot)')
  .option('-r, --rates <rates>', 'override rate levels, comma-separated')
  .action(async (id: string, o) => {
    const exp = experimentById(id);
    const runs = planExperiment(exp, {
      reps: o.reps ? Number(o.reps) : undefined,
      duration: o.duration,
      rates: o.rates ? String(o.rates).split(',').map(Number) : undefined,
    });
    console.log(`\n${exp.id}: ${exp.title}\nQ: ${exp.question}\nH: ${exp.hypothesis}\n`);
    await runJob(new Job(exp.id, runs));
  });

program
  .command('report')
  .description('aggregate repetitions (mean ± 95 % CI), detect the knee, write results/aggregate.csv')
  .option('-e, --experiment <id>', 'only this experiment')
  .action((o) => {
    const { rows, groups, knees } = buildReport(o.experiment);
    if (!rows.length) return console.log('no results yet. Run an experiment first.');
    writeAggregateCsv(groups);
    const f = (g: (typeof groups)[0], m: string, d = 1) =>
      `${round(g.stats[m].mean, d)}${g.n > 1 ? `±${round(g.stats[m].ci95, d)}` : ''}`;
    console.table(groups.map((g) => ({
      exp: g.experiment, target: g.target, profile: g.profile, rate: g.rate, n: g.n,
      'achieved/s': f(g, 'achieved_rps', 0), 'p95 ms': f(g, 'lat_p95', 2), 'p99 ms': f(g, 'lat_p99', 2),
      'err %': round(g.stats.error_rate.mean * 100, 2), dropped: round(g.stats.dropped.mean, 0),
      'api cpu %': f(g, 'api_cpu_avg'), 'db cpu %': f(g, 'db_cpu_avg'), 'k6 cpu %': f(g, 'k6_cpu_avg'),
      'loop lag p99': f(g, 'el_lag_p99_avg_ms', 2), 'pool wait': f(g, 'pool_waiting_max', 0),
    })));
    for (const [key, knee] of Object.entries(knees))
      console.log(`knee ${key.replace('|', ' / ')}: ${knee ? `${knee.rate} req/s (${knee.reason})` : 'not reached in the measured range'}`);
    console.log(`\n→ ${path.relative(process.cwd(), AGGREGATE_CSV)}`);
  });

program
  .command('reset')
  .description('recreate the eventload DB from the seeded template and restart the API')
  .action(async () => {
    await mustCompose(['stop', 'api']);
    await resetDatabase();
    await mustCompose(['start', 'api']);
    await waitForApi();
    console.log('✔ database reset');
  });

program
  .command('ui')
  .description('start the web UI')
  .option('--port <port>', 'port', '4000')
  .action(async (o) => {
    const { startServer } = await import('./server.js');
    startServer(Number(o.port));
  });

program.parseAsync().catch((err) => {
  console.error(`✖ ${err.message ?? err}`);
  process.exit(1);
});
