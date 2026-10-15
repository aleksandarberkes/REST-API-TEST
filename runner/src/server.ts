// Backend of the web UI: catalog, start/stop jobs, live events (SSE), results.
import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { loadCatalog } from './catalog.js';
import { readCsv } from './csv.js';
import { estimateSeconds, experimentById, Job, planExperiment } from './jobs.js';
import { AGGREGATE_CSV, RUNS, SUMMARY_CSV, UI_DIST } from './paths.js';
import { buildReport, writeAggregateCsv } from './report.js';
import type { RunSpec } from './run.js';

export function startServer(port: number) {
  const app = express();
  app.use(express.json());

  let job: Job | null = null;
  let lastStatus: unknown = null;
  const logTail: string[] = [];
  const clients = new Set<express.Response>();
  const broadcast = (event: string, data: unknown) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) c.write(msg);
  };

  function launch(next: Job) {
    if (job && job.status.state === 'running') return false;
    job = next;
    logTail.length = 0;
    job.on('log', (line: string) => {
      logTail.push(line);
      if (logTail.length > 500) logTail.shift();
      console.log(line);
      broadcast('log', line);
    });
    job.on('sample', (s) => broadcast('sample', s));
    job.on('status', (s) => broadcast('status', (lastStatus = { ...s })));
    job.on('row', (r) => broadcast('row', r));
    void job.start();
    return true;
  }

  app.get('/api/catalog', (_req, res) => {
    const c = loadCatalog();
    const experiments = c.experiments.map((e) => {
      const runs = planExperiment(e);
      return { ...e, runs: runs.length, estimateSeconds: estimateSeconds(runs) };
    });
    res.json({ ...c, experiments });
  });

  app.get('/api/status', (_req, res) => res.json({ status: lastStatus, log: logTail }));

  app.get('/api/stream', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`event: hello\ndata: {}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  });

  app.post('/api/run', (req, res) => {
    const c = loadCatalog();
    const { target, profile = 'constant', rate, duration, reps = 1 } = req.body ?? {};
    if (!c.targets[target]) return res.status(400).json({ error: 'unknown target' });
    if (!c.profiles[profile]) return res.status(400).json({ error: 'unknown profile' });
    const runs: RunSpec[] = [];
    for (let rep = 1; rep <= Math.min(Number(reps) || 1, 20); rep++)
      runs.push({
        experiment: 'adhoc', target, profile, rep,
        rate: Number(rate) || c.profiles[profile].defaults.rate,
        duration: duration || c.profiles[profile].defaults.duration,
      });
    if (!launch(new Job(`${target} / ${profile}`, runs))) return res.status(409).json({ error: 'a job is already running' });
    res.status(202).json({ ok: true });
  });

  app.post('/api/experiment', (req, res) => {
    try {
      const { id, reps, duration } = req.body ?? {};
      const exp = experimentById(id);
      const runs = planExperiment(exp, { reps: reps ? Number(reps) : undefined, duration: duration || undefined });
      if (!launch(new Job(exp.id, runs))) return res.status(409).json({ error: 'a job is already running' });
      res.status(202).json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: String((err as Error).message) });
    }
  });

  app.post('/api/stop', async (_req, res) => {
    if (job?.status.state === 'running') await job.abort();
    res.json({ ok: true });
  });

  app.get('/api/results', (req, res) => {
    const exp = typeof req.query.experiment === 'string' && req.query.experiment ? req.query.experiment : undefined;
    res.json(buildReport(exp));
  });

  app.get('/api/files/summary.csv', (_req, res) => res.download(SUMMARY_CSV));
  app.get('/api/files/aggregate.csv', (_req, res) => {
    writeAggregateCsv(buildReport().groups);
    res.download(AGGREGATE_CSV);
  });

  app.get('/api/runs/:id/resources', (req, res) => {
    const id = path.basename(req.params.id);
    res.json(readCsv(path.join(RUNS, id, 'resources.csv')));
  });

  app.use('/runs', express.static(RUNS));
  // The React UI (built by `npm run ui`; during development Vite serves it on :5173 instead).
  app.use(express.static(UI_DIST));
  app.get('/{*splat}', (_req, res) => {
    if (existsSync(path.join(UI_DIST, 'index.html'))) res.sendFile(path.join(UI_DIST, 'index.html'));
    else res.status(404).send('UI not built. Run `npm run ui` (or `npm run ui:dev` for development).');
  });

  app.listen(port, () => console.log(`EventLoad UI → http://localhost:${port}`));
}
