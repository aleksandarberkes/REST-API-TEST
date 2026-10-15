import { Router } from 'express';
import { pool } from '../db/pool.js';
import { snapshot } from '../metrics.js';

export const internal = Router();

internal.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

internal.get('/internal/metrics', (_req, res) => {
  const mem = process.memoryUsage();
  res.json({
    ts: Date.now(),
    ...snapshot(),
    pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
    memoryMb: { rss: +(mem.rss / 2 ** 20).toFixed(1), heapUsed: +(mem.heapUsed / 2 ** 20).toFixed(1) },
  });
});
