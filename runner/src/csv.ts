import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

export type Row = Record<string, string | number>;

const cell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: Row[], columns = Object.keys(rows[0] ?? {})): string {
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

export function writeCsv(file: string, rows: Row[], columns?: string[]) {
  writeFileSync(file, toCsv(rows, columns));
}

/** Appends one row, writing the header first if the file is new. */
export function appendCsv(file: string, row: Row, columns: string[]) {
  if (!existsSync(file)) writeFileSync(file, columns.join(',') + '\n');
  appendFileSync(file, columns.map((c) => cell(row[c])).join(',') + '\n');
}

export function readCsv(file: string): Row[] {
  if (!existsSync(file)) return [];
  const [header, ...lines] = readFileSync(file, 'utf8').trim().split('\n');
  if (!header) return [];
  const cols = header.split(',');
  return lines.filter(Boolean).map((line) => {
    const values = line.split(','); // our values never contain commas
    return Object.fromEntries(cols.map((c, i) => [c, num(values[i])]));
  });
}

const num = (v: string | undefined) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : (v ?? ''));
