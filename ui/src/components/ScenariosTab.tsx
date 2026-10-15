import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import type { Catalog, Experiment, Profile, Target } from '../lib/api';
import { fmtDuration } from '../lib/format';
import { profileShape } from '../lib/profileShape';

export interface RunPreset {
  target: string;
  profile: string;
  rate?: number;
  duration?: string;
}

interface Props {
  catalog: Catalog;
  running: boolean;
  onExperiment: (id: string, pilot: boolean) => void;
  onPreset: (preset: RunPreset) => void;
}

export function ScenariosTab({ catalog, running, onExperiment, onPreset }: Props) {
  return (
    <div className="space-y-10">
      <p className="max-w-4xl text-zinc-600 dark:text-zinc-400">
        A <b className="text-zinc-900 dark:text-zinc-100">scenario</b> is an <b>endpoint</b> (what work one request does) ×
        a <b>load profile</b> (how requests arrive over time) × a <b>rate</b> (requests per second).{' '}
        <b className="text-zinc-900 dark:text-zinc-100">Experiments</b> are prepared series of scenarios that answer one
        research question. Each run starts from a fresh database copy and a restarted API, so the runs are comparable.
      </p>

      <Section title="Experiments" subtitle="Run the full series, or a quick pilot (1 repetition, 15 s per level) to check that everything works.">
        <div className="grid gap-4 lg:grid-cols-2">
          {catalog.experiments.map((e) => (
            <ExperimentCard key={e.id} e={e} catalog={catalog} running={running} onRun={onExperiment} />
          ))}
        </div>
      </Section>

      <Section title="Endpoints" subtitle="Each endpoint does a different kind of work, so each one saturates a different resource first.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(catalog.targets).map(([id, t]) => (
            <TargetCard key={id} id={id} t={t} onTry={() => onPreset({ target: id, profile: 'constant' })} />
          ))}
        </div>
      </Section>

      <Section title="Load profiles" subtitle="How the offered request rate changes during one run (shown with the default rate and duration).">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(catalog.profiles).map(([id, p]) => (
            <ProfileCard key={id} id={id} p={p} onTry={() => onPreset({ target: 'event-by-id', profile: id, ...p.defaults })} />
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="hint mb-4">{subtitle}</p>
      {children}
    </section>
  );
}

function ExperimentCard({ e, catalog, running, onRun }: { e: Experiment; catalog: Catalog; running: boolean; onRun: Props['onExperiment'] }) {
  return (
    <article className="card flex flex-col">
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">{e.id}</span>
        <h3 className="font-semibold">{e.title}</h3>
      </div>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{e.description}</p>
      <dl className="mt-3 grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-zinc-500">Question</dt>
        <dd>{e.question}</dd>
        <dt className="text-zinc-500">Hypothesis</dt>
        <dd>{e.hypothesis}</dd>
        <dt className="text-zinc-500">Profile</dt>
        <dd>{catalog.profiles[e.profile]?.title ?? e.profile}, {e.duration} per run</dd>
        <dt className="text-zinc-500">Endpoints</dt>
        <dd className="flex flex-wrap gap-1">{e.targets.map((t) => <span key={t} className="chip">{t}</span>)}</dd>
        <dt className="text-zinc-500">Rates</dt>
        <dd className="font-mono text-xs leading-5">{e.rates.join(' · ')} req/s</dd>
      </dl>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        <button className="btn btn-primary" disabled={running} onClick={() => onRun(e.id, false)}>
          Run full
        </button>
        <button className="btn" disabled={running} onClick={() => onRun(e.id, true)}>
          Pilot
        </button>
        <span className="hint ml-auto">
          {e.runs} runs ({e.reps} reps) · ~{fmtDuration(e.estimateSeconds)}
        </span>
      </div>
    </article>
  );
}

const KIND_STYLES = {
  read: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300',
  write: 'bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-300',
  mix: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
};

function TargetCard({ id, t, onTry }: { id: string; t: Target; onTry: () => void }) {
  return (
    <article className="card flex flex-col">
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${KIND_STYLES[t.kind]}`}>{t.kind}</span>
        <h3 className="font-semibold">{t.title}</h3>
      </div>
      <code className="mt-1 text-xs text-zinc-500">{t.request}</code>
      {t.cost && <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">Cost: {t.cost}</p>}
      <p className="mt-2 text-sm">{t.description}</p>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400"><b className="text-zinc-800 dark:text-zinc-200">Why:</b> {t.why}</p>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400"><b className="text-zinc-800 dark:text-zinc-200">Expect:</b> {t.expect}</p>
      <div className="mt-auto flex items-center pt-3">
        <span className="hint font-mono">{id}</span>
        <button className="btn ml-auto" onClick={onTry}>Try it →</button>
      </div>
    </article>
  );
}

function ProfileCard({ id, p, onTry }: { id: string; p: Profile; onTry: () => void }) {
  const shape = profileShape(id, p.defaults.rate, p.defaults.duration);
  return (
    <article className="card flex flex-col">
      <div className="flex items-baseline gap-2">
        <h3 className="font-semibold">{p.title}</h3>
        <span className="chip font-mono">{p.executor}</span>
      </div>
      <div className="mt-3 h-24">
        <ResponsiveContainer>
          <AreaChart data={shape} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
            <XAxis dataKey="t" type="number" domain={[0, 'dataMax']} tick={{ fontSize: 10, fill: '#71717a' }} unit="s" stroke="#a1a1aa" />
            <YAxis tick={{ fontSize: 10, fill: '#71717a' }} stroke="#a1a1aa" domain={[0, 'auto']} />
            <Area type="linear" dataKey="rate" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="hint -mt-1 text-center">req/s over time · default {p.defaults.rate} req/s, {p.defaults.duration}</p>
      <p className="mt-3 text-sm">{p.description}</p>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400"><b className="text-zinc-800 dark:text-zinc-200">Why:</b> {p.why}</p>
      <div className="mt-auto flex pt-3">
        <button className="btn ml-auto" onClick={onTry}>Try it →</button>
      </div>
    </article>
  );
}
