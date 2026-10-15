import { useEffect, useRef, useState } from 'react';
import { api, type Catalog, type JobStatus, type Sample } from '../lib/api';
import { fmtDuration } from '../lib/format';
import { SampleCharts } from './SampleCharts';
import type { RunPreset } from './ScenariosTab';

interface Props {
  catalog: Catalog;
  preset: RunPreset | null;
  status: JobStatus | null;
  running: boolean;
  samples: Sample[];
  log: string[];
}

export function RunTab({ catalog, preset, status, running, samples, log }: Props) {
  const [target, setTarget] = useState('event-by-id');
  const [profile, setProfile] = useState('constant');
  const [rate, setRate] = useState(100);
  const [duration, setDuration] = useState('60s');
  const [reps, setReps] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!preset) return;
    const p = catalog.profiles[preset.profile];
    setTarget(preset.target);
    setProfile(preset.profile);
    setRate(preset.rate ?? p?.defaults.rate ?? 100);
    setDuration(preset.duration ?? p?.defaults.duration ?? '60s');
  }, [preset, catalog]);

  const changeProfile = (id: string) => {
    setProfile(id);
    setRate(catalog.profiles[id].defaults.rate);
    setDuration(catalog.profiles[id].defaults.duration);
  };

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.run({ target, profile, rate, duration, reps });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const t = catalog.targets[target];
  const p = catalog.profiles[profile];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <form onSubmit={start} className="card space-y-3">
          <h3 className="font-semibold">Ad-hoc run</h3>
          <label className="label">
            Endpoint
            <select className="field" value={target} onChange={(e) => setTarget(e.target.value)}>
              {Object.entries(catalog.targets).map(([id, x]) => (
                <option key={id} value={id}>{x.title} ({x.request})</option>
              ))}
            </select>
          </label>
          {t && <p className="hint">{t.description}</p>}
          <label className="label">
            Load profile
            <select className="field" value={profile} onChange={(e) => changeProfile(e.target.value)}>
              {Object.entries(catalog.profiles).map(([id, x]) => (
                <option key={id} value={id}>{x.title}</option>
              ))}
            </select>
          </label>
          {p && <p className="hint">{p.description}</p>}
          <div className="flex flex-wrap gap-3">
            <label className="label">
              {profile === 'constant' || profile === 'soak' ? 'Rate (req/s)' : 'Peak rate (req/s)'}
              <input className="field" type="number" min={1} value={rate} disabled={profile === 'smoke'} onChange={(e) => setRate(Number(e.target.value))} />
            </label>
            <label className="label">
              Duration
              <input className="field" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="60s" />
            </label>
            <label className="label">
              Repetitions
              <input className="field" type="number" min={1} max={20} value={reps} onChange={(e) => setReps(Number(e.target.value))} />
            </label>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button type="submit" className="btn btn-primary" disabled={running}>Start run</button>
            <button type="button" className="btn btn-danger" disabled={!running} onClick={() => api.stop()}>Stop</button>
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
          <p className="hint">
            Protocol for every run: reset the DB from its template → restart the API → 10 s warm-up (not recorded) →
            measure. Results go to <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">results/</code>.
          </p>
        </form>

        <StatusCard status={status} running={running} />
      </div>

      <SampleCharts samples={samples} live />
      <LogView log={log} />
    </div>
  );
}

function StatusCard({ status, running }: { status: JobStatus | null; running: boolean }) {
  const pct = status ? Math.round((status.completed / Math.max(1, status.total)) * 100) : 0;
  const c = status?.current;
  return (
    <div className="card space-y-3">
      <h3 className="font-semibold">Status</h3>
      {!status ? (
        <p className="hint">No job started yet. Start an ad-hoc run here, or an experiment from the Scenarios tab.</p>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium">{status.label}</span>
            <span className="hint">{status.completed} / {status.total} runs</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${running ? Math.max(pct, 2) : pct}%` }} />
          </div>
          {c && (
            <p className="text-sm">
              Now: <b>{c.target}</b> · {c.profile} · {c.rate} req/s · {c.duration} · rep {c.rep}
            </p>
          )}
          {running && <p className="hint">Remaining ≈ {fmtDuration(status.etaSeconds)}</p>}
          {!running && <p className={`text-sm font-medium ${status.state === 'done' ? 'text-green-600' : 'text-red-600'}`}>{status.state}{status.error ? `: ${status.error}` : ''}</p>}
        </>
      )}
      <p className="hint">
        While k6 is measuring, its own live dashboard is at{' '}
        <a className="text-blue-600 underline dark:text-blue-400" href="http://localhost:5665" target="_blank" rel="noreferrer">localhost:5665</a>.
        Every finished run also saves it as <code>k6-report.html</code>.
      </p>
    </div>
  );
}

function LogView({ log }: { log: string[] }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [log]);
  return (
    <div className="card">
      <h4 className="mb-2 text-sm font-semibold">Log</h4>
      <pre ref={ref} className="max-h-80 overflow-auto font-mono text-xs leading-relaxed whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
        {log.length ? log.join('\n') : 'Nothing yet.'}
      </pre>
    </div>
  );
}
