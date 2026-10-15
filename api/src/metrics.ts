import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { RequestHandler } from 'express';

// Lightweight in-process counters, read by the runner once per second via /internal/metrics.
const RESOLUTION_MS = 10;
const loopDelay = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
loopDelay.enable();

let completed = 0;
let errors5xx = 0;
let latencySumMs = 0;

export const countRequests: RequestHandler = (req, res, next) => {
  if (req.path.startsWith('/internal')) return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    completed++;
    if (res.statusCode >= 500) errors5xx++;
    latencySumMs += Number(process.hrtime.bigint() - start) / 1e6;
  });
  next();
};

/** Returns counters accumulated since the previous call, then resets them. */
export function snapshot() {
  // The histogram records the whole timer interval; lag is what exceeds the sampling resolution.
  const ns = (v: number) => +Math.max(0, v / 1e6 - RESOLUTION_MS).toFixed(3);
  const out = {
    requests: completed,
    errors5xx,
    avgServerMs: completed ? +(latencySumMs / completed).toFixed(3) : 0,
    eventLoopLagMs: {
      mean: ns(loopDelay.mean),
      p50: ns(loopDelay.percentile(50)),
      p99: ns(loopDelay.percentile(99)),
      max: ns(loopDelay.max),
    },
  };
  completed = 0;
  errors5xx = 0;
  latencySumMs = 0;
  loopDelay.reset();
  return out;
}
