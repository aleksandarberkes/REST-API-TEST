// A job = an ordered list of runs (one ad-hoc run, or a whole experiment).
// Used by both the CLI and the UI server; emits log / sample / progress events.
import { EventEmitter } from 'node:events';
import { loadCatalog, profileSeconds, type Experiment } from './catalog.js';
import { AbortedError, killK6, runOne, type RunSpec } from './run.js';

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

/**
 * Runs of an experiment. Order is repetition-major (all levels for rep 1, then rep 2, …) so slow
 * drift of the machine (thermals, background tasks) spreads evenly over levels instead of biasing one.
 */
export function planExperiment(exp: Experiment, o: { reps?: number; duration?: string; rates?: number[] } = {}): RunSpec[] {
  const runs: RunSpec[] = [];
  const reps = o.reps ?? exp.reps;
  for (let rep = 1; rep <= reps; rep++)
    for (const target of exp.targets)
      for (const rate of o.rates ?? exp.rates)
        runs.push({ experiment: exp.id, target, profile: exp.profile, rate, duration: o.duration ?? exp.duration, rep });
  return runs;
}

// Reset + restart + warm-up + summary/cooldown overhead per run, in seconds (rough, for ETA only).
const OVERHEAD_S = 25;
export const estimateSeconds = (runs: RunSpec[]) =>
  runs.reduce((s, r) => s + profileSeconds(r.profile, r.duration) + OVERHEAD_S, 0);

export class Job extends EventEmitter {
  private abortFlag = false;
  readonly status: JobStatus;

  constructor(readonly label: string, readonly runs: RunSpec[]) {
    super();
    this.status = {
      id: Date.now().toString(36), label, state: 'running', total: runs.length, completed: 0,
      startedAt: new Date().toISOString(), etaSeconds: estimateSeconds(runs),
    };
  }

  async start() {
    try {
      for (const spec of this.runs) {
        this.status.current = spec;
        this.status.etaSeconds = estimateSeconds(this.runs.slice(this.status.completed));
        this.emit('status', this.status);
        const row = await runOne(spec, {
          log: (line) => this.emit('log', line),
          sample: (s) => this.emit('sample', s),
          aborted: () => this.abortFlag,
        });
        this.status.completed++;
        this.emit('row', row);
        if (this.abortFlag) throw new AbortedError('aborted');
      }
      this.status.state = 'done';
    } catch (err) {
      this.status.state = err instanceof AbortedError ? 'aborted' : 'failed';
      if (!(err instanceof AbortedError)) this.status.error = String((err as Error).message ?? err);
      this.emit('log', `✖ ${this.status.state}${this.status.error ? `: ${this.status.error}` : ''}`);
    } finally {
      this.status.current = undefined;
      this.status.etaSeconds = 0;
      this.emit('status', this.status);
      this.emit('end', this.status);
    }
    return this.status;
  }

  async abort() {
    this.abortFlag = true;
    await killK6();
  }
}

export function experimentById(id: string) {
  const exp = loadCatalog().experiments.find((e) => e.id.toLowerCase() === id.toLowerCase());
  if (!exp) throw new Error(`unknown experiment ${id}`);
  return exp;
}
