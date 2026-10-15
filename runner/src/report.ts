import { readCsv, writeCsv } from './csv.js';
import { AGGREGATE_CSV, SUMMARY_CSV } from './paths.js';
import { AGG_METRICS, aggregate, findKnee, round, type Group } from './stats.js';

export function buildReport(experiment?: string) {
  const rows = readCsv(SUMMARY_CSV).filter((r) => !experiment || r.experiment === experiment);
  const groups = aggregate(rows);
  const knees: Record<string, ReturnType<typeof findKnee>> = {};
  for (const g of groups) {
    if (g.profile !== 'constant') continue;
    const key = `${g.experiment}|${g.target}`;
    if (key in knees) continue;
    knees[key] = findKnee(groups.filter((x) => x.experiment === g.experiment && x.target === g.target && x.profile === 'constant'));
  }
  return { rows, groups, knees };
}

export function writeAggregateCsv(groups: Group[]) {
  const flat = groups.map((g) => {
    const row: Record<string, string | number> = { experiment: g.experiment, target: g.target, profile: g.profile, rate: g.rate, n: g.n };
    for (const m of AGG_METRICS) {
      row[`${m}_mean`] = round(g.stats[m].mean, 3);
      row[`${m}_sd`] = round(g.stats[m].sd, 3);
      row[`${m}_ci95`] = round(g.stats[m].ci95, 3);
    }
    return row;
  });
  if (flat.length) writeCsv(AGGREGATE_CSV, flat);
}
