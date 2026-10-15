import { describe, expect, it } from 'vitest';
import { parseMem, parseStatsLine, type Sample } from '../src/sampler.js';
import { activeWindow, aggregate, ci95, findKnee, mean, median, stddev } from '../src/stats.js';

describe('basic statistics', () => {
  it('mean, median, sample stddev', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
  });

  it('ignores NaN (missed samples)', () => {
    expect(mean([1, Number.NaN, 3])).toBe(2);
  });

  it('95 % CI uses Student t for small n', () => {
    // n = 5, sd = 1 → t(4) = 2.776, half-width = 2.776 / sqrt(5)
    expect(ci95([1, 2, 3, 4, 5].map((x) => x / Math.sqrt(2.5)))).toBeCloseTo(2.776 / Math.sqrt(5), 3);
    expect(ci95([7])).toBe(0);
  });
});

describe('docker stats parsing', () => {
  it('parses memory units', () => {
    expect(parseMem('50.1MiB / 512MiB')).toBe(50.1);
    expect(parseMem('1.5GiB / 2GiB')).toBe(1536);
    expect(parseMem('512KiB / 1GiB')).toBe(0.5);
  });

  it('parses a json line with ANSI codes', () => {
    const line = '\x1b[2J\x1b[H{"Name":"eventload-api-1","CPUPerc":"103.35%","MemUsage":"50.1MiB / 512MiB"}';
    expect(parseStatsLine(line)).toEqual({ name: 'eventload-api-1', cpu: 103.35, mem: 50.1 });
    expect(parseStatsLine('garbage')).toBeNull();
  });
});

const sample = (t: number, api_rps: number): Sample => ({
  t, api_rps, api_cpu: 50, api_mem_mb: 30, db_cpu: 10, db_mem_mb: 100, k6_cpu: 5, k6_mem_mb: 30,
  api_avg_ms: 1, api_5xx: 0, el_lag_p99_ms: 1, el_lag_max_ms: 2, pool_total: 10, pool_waiting: 0, heap_mb: 10,
});

describe('activeWindow', () => {
  it('keeps only the loaded seconds, minus partial edges', () => {
    const s = [sample(1, 0), sample(2, 50), sample(3, 100), sample(4, 100), sample(5, 100), sample(6, 40), sample(7, 0)];
    expect(activeWindow(s).map((x) => x.t)).toEqual([3, 4, 5]);
  });
});

describe('aggregate + knee', () => {
  const row = (rate: number, rep: number, p95: number, achieved = rate) => ({
    experiment: 'E1', target: 'event-by-id', profile: 'constant', rate, rep,
    achieved_rps: achieved, achieved_ratio: achieved / rate, error_rate: 0, dropped: 0, lat_avg: 1, lat_med: 1,
    lat_p95: p95, lat_p99: p95 * 2, api_cpu_avg: 10, api_mem_max_mb: 30, db_cpu_avg: 5, k6_cpu_avg: 5,
    api_rps_max: achieved, el_lag_p99_avg_ms: 1, pool_waiting_max: 0,
  });

  it('groups repetitions per level', () => {
    const g = aggregate([row(10, 1, 2), row(10, 2, 4), row(100, 1, 3)]);
    expect(g).toHaveLength(2);
    expect(g[0].n).toBe(2);
    expect(g[0].stats.lat_p95.mean).toBe(3);
  });

  it('finds the knee by latency', () => {
    const g = aggregate([row(10, 1, 2), row(100, 1, 2.2), row(1000, 1, 3), row(2000, 1, 9)]);
    expect(findKnee(g)?.rate).toBe(2000);
  });

  it('finds the knee by throughput', () => {
    const g = aggregate([row(10, 1, 2), row(100, 1, 2), row(1000, 1, 2, 800)]);
    expect(findKnee(g)).toMatchObject({ rate: 1000 });
  });

  it('one outlier repetition does not move the knee (median)', () => {
    const rows = [10, 100, 1000].flatMap((r) => [1, 2, 3].map((rep) => row(r, rep, 2)));
    rows.push(row(100, 4, 400)); // disturbed run
    expect(findKnee(aggregate(rows))).toBeNull();
  });

  it('returns null when no level degrades', () => {
    expect(findKnee(aggregate([row(10, 1, 2), row(100, 1, 2)]))).toBeNull();
  });
});
