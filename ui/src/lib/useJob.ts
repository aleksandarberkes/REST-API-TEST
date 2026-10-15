import { useEffect, useState } from 'react';
import { api, type JobStatus, type Sample } from './api';

const MAX_LOG = 500;
const MAX_SAMPLES = 400;

/** Live job state from the runner's server-sent events stream. */
export function useJob() {
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [rowsVersion, setRowsVersion] = useState(0);

  useEffect(() => {
    api.status().then((s) => {
      setStatus(s.status);
      setLog(s.log);
    }).catch(() => {});

    const es = new EventSource('/api/stream');
    es.addEventListener('status', (e) => setStatus(JSON.parse(e.data)));
    es.addEventListener('log', (e) => {
      const line: string = JSON.parse(e.data);
      if (line.startsWith('▶')) setSamples([]); // a new run starts: restart the live charts
      setLog((l) => [...l, line].slice(-MAX_LOG));
    });
    es.addEventListener('sample', (e) => setSamples((s) => [...s, JSON.parse(e.data)].slice(-MAX_SAMPLES)));
    es.addEventListener('row', () => setRowsVersion((v) => v + 1));
    return () => es.close();
  }, []);

  const running = status?.state === 'running';
  return { status, log, samples, running, rowsVersion, clearLog: () => setLog([]) };
}
