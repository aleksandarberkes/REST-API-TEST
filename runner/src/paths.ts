import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const RESULTS = path.join(ROOT, 'results');
export const RUNS = path.join(RESULTS, 'runs');
export const SUMMARY_CSV = path.join(RESULTS, 'summary.csv');
export const AGGREGATE_CSV = path.join(RESULTS, 'aggregate.csv');
export const CATALOG = path.join(ROOT, 'load', 'catalog.json');
export const UI_DIST = path.join(ROOT, 'ui', 'dist');
export const API_URL = process.env.API_URL ?? 'http://localhost:3000';
