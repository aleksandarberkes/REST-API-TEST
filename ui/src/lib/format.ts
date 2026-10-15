export const fmtNum = (v: unknown, digits = 1) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: digits }) : '–';
};

export const fmtDuration = (seconds: number) => {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

export function durationSeconds(d: string): number {
  const m = /^(\d+)(s|m|h)$/.exec(d);
  return m ? Number(m[1]) * { s: 1, m: 60, h: 3600 }[m[2] as 's' | 'm' | 'h'] : 60;
}

// Series colours (readable in light and dark mode).
export const COLORS = {
  api: '#3b82f6',
  db: '#14b8a6',
  k6: '#f59e0b',
  p50: '#a5b4fc',
  p95: '#6366f1',
  p99: '#db2777',
  ideal: '#a1a1aa',
  danger: '#ef4444',
};
export const PALETTE = ['#3b82f6', '#db2777', '#14b8a6', '#f59e0b', '#8b5cf6', '#64748b', '#84cc16', '#f97316'];
