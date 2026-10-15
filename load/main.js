// k6 entry point. Everything is driven by environment variables:
//   TARGET   one of catalog.targets      (e.g. event-by-id)
//   PROFILE  one of catalog.profiles     (smoke | constant | stress | spike | soak | breakpoint | warmup)
//   RATE     requests (iterations) per second, or the peak rate for ramping profiles
//   DURATION e.g. 60s, 5m
//   OUT_DIR  where handleSummary writes k6-summary.json (optional)
import { check, sleep } from 'k6';
import { createHotEvent, getEvent, mixed, requests } from './lib/endpoints.js';
import { buildScenario, thresholdsFor } from './lib/profiles.js';

const catalog = JSON.parse(open('./catalog.json'));

const TARGET = __ENV.TARGET || 'event-by-id';
const PROFILE = __ENV.PROFILE || 'smoke';
const defaults = catalog.profiles[PROFILE]?.defaults ?? { rate: 10, duration: '10s' };
const RATE = Number(__ENV.RATE || defaults.rate);
const DURATION = __ENV.DURATION || defaults.duration;
const target = catalog.targets[TARGET];
if (!target) throw new Error(`unknown TARGET ${TARGET}`);

const HOT_CAPACITY = 500;

export const options = {
  scenarios: { [PROFILE]: buildScenario(PROFILE, RATE, DURATION) },
  thresholds: thresholdsFor(PROFILE),
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  discardResponseBodies: true,
  setupTimeout: '30s',
};

export function setup() {
  if (TARGET === 'hot-event-rush') return { hotEventId: createHotEvent(HOT_CAPACITY) };
  return {};
}

export default function (data) {
  if (target.mix) mixed(target.mix);
  else requests[TARGET](data);
  if (PROFILE === 'smoke') sleep(0.1); // gentle ~10 req/s: a sanity check, not a load
}

export function teardown(data) {
  if (!data.hotEventId) return;
  const ev = getEvent(data.hotEventId);
  console.log(`hot event ${ev.id}: registered ${ev.registered_count} / capacity ${ev.capacity}`);
  check(ev, { 'hot event never overbooked': (e) => e.registered_count <= e.capacity });
}

export function handleSummary(data) {
  const m = data.metrics;
  const d = m.http_req_duration?.values ?? {};
  const fmt = (v) => (v === undefined ? '-' : `${v.toFixed(2)} ms`);
  const lines = [
    '',
    `  target=${TARGET} profile=${PROFILE} rate=${RATE}/s duration=${DURATION}`,
    `  requests:  ${m.http_reqs?.values.count ?? 0}  (${(m.http_reqs?.values.rate ?? 0).toFixed(1)}/s)`,
    `  failed:    ${((m.http_req_failed?.values.rate ?? 0) * 100).toFixed(2)} %`,
    `  dropped:   ${m.dropped_iterations?.values.count ?? 0} iterations`,
    `  latency:   avg ${fmt(d.avg)}  med ${fmt(d.med)}  p95 ${fmt(d['p(95)'])}  p99 ${fmt(d['p(99)'])}  max ${fmt(d.max)}`,
    '',
  ];
  const out = { stdout: lines.join('\n') };
  if (__ENV.OUT_DIR) out[`${__ENV.OUT_DIR}/k6-summary.json`] = JSON.stringify(data, null, 1);
  return out;
}
