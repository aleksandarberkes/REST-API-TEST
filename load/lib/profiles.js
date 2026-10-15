// Turns a profile id + RATE + DURATION into a k6 scenario (executor config).
// Arrival-rate executors = open model: k6 starts RATE iterations per second regardless of
// how slow responses are. If it runs out of VUs it records `dropped_iterations`.

const MAX_VUS_CAP = 1000;

function vus(rate) {
  // In-flight requests ≈ rate × latency (Little's law). Pre-allocate for ~200 ms latency,
  // allow growth up to 2 s of latency (capped to protect the VM's memory).
  return {
    preAllocatedVUs: Math.min(Math.max(10, Math.ceil(rate * 0.2)), MAX_VUS_CAP),
    maxVUs: Math.min(Math.max(50, rate * 2), MAX_VUS_CAP),
  };
}

function seconds(d) {
  const m = /^(\d+)(s|m|h)$/.exec(d);
  if (!m) throw new Error(`bad duration ${d}`);
  return Number(m[1]) * { s: 1, m: 60, h: 3600 }[m[2]];
}

export function buildScenario(profile, rate, duration) {
  switch (profile) {
    case 'smoke':
      return { executor: 'constant-vus', vus: 1, duration };
    case 'warmup':
    case 'constant':
    case 'soak':
      return { executor: 'constant-arrival-rate', rate, timeUnit: '1s', duration, ...vus(rate) };
    case 'stress':
    case 'breakpoint':
      return {
        executor: 'ramping-arrival-rate',
        startRate: 1,
        timeUnit: '1s',
        stages: [{ target: rate, duration }],
        ...vus(rate),
      };
    case 'spike': {
      const base = Math.max(10, Math.round(rate * 0.05));
      return {
        executor: 'ramping-arrival-rate',
        startRate: base,
        timeUnit: '1s',
        stages: [
          { target: base, duration: '20s' },
          { target: rate, duration: '5s' },
          { target: rate, duration },
          { target: base, duration: '5s' },
          { target: base, duration: '20s' },
        ],
        ...vus(rate),
      };
    }
    default:
      throw new Error(`unknown profile ${profile}`);
  }
}

export function thresholdsFor(profile) {
  if (profile !== 'breakpoint') return {};
  return {
    http_req_duration: [{ threshold: 'p(95)<1000', abortOnFail: true, delayAbortEval: '10s' }],
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '10s' }],
    // Out of VUs = responses are so slow that k6 can no longer offer the target rate.
    dropped_iterations: [{ threshold: 'count<500', abortOnFail: true }],
  };
}

export { seconds };
