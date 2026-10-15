import { readFileSync } from 'node:fs';
import { CATALOG } from './paths.js';

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
}
export interface Catalog {
  targets: Record<string, Target>;
  profiles: Record<string, Profile>;
  experiments: Experiment[];
}

export function loadCatalog(): Catalog {
  return JSON.parse(readFileSync(CATALOG, 'utf8'));
}

export function durationSeconds(d: string): number {
  const m = /^(\d+)(s|m|h)$/.exec(d);
  if (!m) throw new Error(`invalid duration "${d}" (use e.g. 30s, 5m)`);
  return Number(m[1]) * { s: 1, m: 60, h: 3600 }[m[2] as 's' | 'm' | 'h'];
}

/** Wall-clock length of the measured part of a run, matching load/lib/profiles.js. */
export function profileSeconds(profile: string, duration: string): number {
  const d = durationSeconds(duration);
  return profile === 'spike' ? d + 50 : d;
}
