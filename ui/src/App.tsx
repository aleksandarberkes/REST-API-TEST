import { useEffect, useState } from 'react';
import { ResultsTab } from './components/ResultsTab';
import { RunTab } from './components/RunTab';
import { ScenariosTab, type RunPreset } from './components/ScenariosTab';
import { api, type Catalog } from './lib/api';
import { useJob } from './lib/useJob';

const TABS = ['Scenarios', 'Run', 'Results'] as const;
type Tab = (typeof TABS)[number];

const STATE_STYLES: Record<string, string> = {
  running: 'border-blue-500 text-blue-600 dark:text-blue-400',
  done: 'border-green-500 text-green-600 dark:text-green-400',
  failed: 'border-red-500 text-red-600 dark:text-red-400',
  aborted: 'border-red-500 text-red-600 dark:text-red-400',
};

export function App() {
  const [tab, setTab] = useState<Tab>('Scenarios');
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<RunPreset | null>(null);
  const job = useJob();

  useEffect(() => {
    api.catalog().then(setCatalog).catch((e) => setError(String(e.message)));
  }, []);

  const startExperiment = async (id: string, pilot: boolean) => {
    try {
      await api.experiment(pilot ? { id, reps: 1, duration: '15s' } : { id });
      setTab('Run');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <div>
            <div className="font-bold tracking-tight">EventLoad Lab</div>
            <div className="hint">REST API under load · Express + PostgreSQL + k6</div>
          </div>
          <nav className="flex gap-1">
            {TABS.map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-sm transition ${tab === t
                  ? 'bg-zinc-100 font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'}`}>
                {t}
              </button>
            ))}
          </nav>
          <button onClick={() => setTab('Run')}
            className={`ml-auto cursor-pointer rounded-full border px-3 py-0.5 text-xs font-medium ${job.status ? STATE_STYLES[job.status.state] : 'border-zinc-300 text-zinc-500 dark:border-zinc-700'}`}>
            {job.running ? `running ${job.status!.completed}/${job.status!.total}` : (job.status?.state ?? 'idle')}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
            {error} <button className="ml-2 underline" onClick={() => setError(null)}>dismiss</button>
          </div>
        )}
        {!catalog ? (
          <p className="hint">Loading catalog…</p>
        ) : (
          <>
            <div hidden={tab !== 'Scenarios'}>
              <ScenariosTab catalog={catalog} running={job.running} onExperiment={startExperiment}
                onPreset={(p) => { setPreset({ ...p }); setTab('Run'); }} />
            </div>
            <div hidden={tab !== 'Run'}>
              <RunTab catalog={catalog} preset={preset} status={job.status} running={job.running} samples={job.samples} log={job.log} />
            </div>
            {tab === 'Results' && <ResultsTab catalog={catalog} version={job.rowsVersion} />}
          </>
        )}
      </main>
    </div>
  );
}
