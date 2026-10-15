# EventLoad Lab: REST API under load

Course project A8 (Integracija informacionih tehnologija). The program is the **measuring instrument**: a small
event-registration REST API (Node.js + Express + PostgreSQL), k6 load scripts, a terminal runner that applies a
fixed measurement protocol, and a web UI that explains every scenario and charts the results.

**Research question (E1):** how does the request rate affect latency, throughput, CPU and memory, and at what rate
does the API degrade significantly?

## Quick start

Requirements: Docker Desktop (Settings → Resources: **8 CPUs, 8 GB**), Node.js 22.

```bash
cp .env.example .env
npm install
npm run setup                     # Postgres + seeded template DB + API container + k6 image
npm run lt -- list                # every endpoint / profile / experiment, with explanations
npm run lt -- run event-by-id --rate 500 --duration 30s
npm run lt -- experiment E1 --reps 1 --duration 15s   # pilot
npm run lt -- experiment E1       # the real thing: 12 levels × 5 reps (~1.5 h)
npm run lt -- report              # mean ± 95 % CI per level, knee detection → results/aggregate.csv
npm run ui                        # http://localhost:4000
npm test                          # API functional tests + runner unit tests (needs `npm run setup` first)
```

UI development with hot reload: `npm run lt -- ui` in one terminal, `npm run ui:dev` in another (→ :5173).

## Layout

```
docker-compose.yml   db / api / k6, each pinned to its own cores (cpuset)
api/                 Express + TypeScript API (system under test), Dockerfile, OpenAPI at /docs, tests
db/                  schema.sql + deterministic seed.sql (10k users, 1k events, 50k registrations)
load/catalog.json    single source of truth: endpoints, load profiles, experiments + explanations
load/main.js         k6 entry; TARGET / PROFILE / RATE / DURATION come from env
load/lib/            request per endpoint, profile → k6 executor
runner/              CLI (`npm run lt`), run protocol, resource sampler, statistics, UI server
ui/                  React + Tailwind + Recharts (Vite)
results/summary.csv  one row per run (raw data for the paper)
results/runs/<id>/   k6-summary.json, k6-report.html, resources.csv (per second), api.log, meta.json
```

## Measurement protocol (every run)

1. Recreate the database from the seeded template, so every run starts from identical data.
2. Restart the API container (cold process, empty pool) and wait for `/api/health`.
3. 10 s warm-up at 10 % of the rate. This is **not recorded**.
4. Measure with an **arrival-rate** executor (open model): k6 starts exactly RATE requests per second regardless
   of response time. If the API can't keep up, k6 reports `dropped_iterations` instead of quietly slowing down
   (it avoids "coordinated omission").
5. Once per second, record CPU and memory of the api / db / k6 containers (`docker stats`), plus the API's served
   req/s, event-loop lag and pg-pool queue (`/internal/metrics`).
6. Save the artifacts and append a row to `results/summary.csv`. Experiments run repetition by repetition
   (all levels for rep 1, then rep 2, …), so slow drift of the machine doesn't bias one level.

**Knee detection:** the first level where the median over repetitions shows achieved < 95 % of offered,
p95 > 3× baseline, or errors > 1 %.

## Single-machine setup and its limits

Load generator and API share one MacBook (Apple M3, 4 performance + 4 efficiency cores). To keep k6 from
competing with the API, Docker pins **API → core 0, PostgreSQL → cores 1–2, k6 → cores 4–7** inside the Docker
VM. The API gets exactly one core, the same as a single Node.js event loop. Report these limitations in the paper:

- Docker on macOS runs in a Linux VM. That adds a roughly constant overhead, the same for every run.
- Which physical core (P or E) backs a VM core is up to macOS.
- **Stop all other containers and heavy apps before final measurements.** The runner warns about other running
  containers and records the count in every row (`other_containers`).
- k6 CPU is recorded too. If it approaches its 400 % budget, the generator, not the API, is the limit.

Pilot finding (2026-10-15): one pinned core serves `GET /api/events/:id` up to ~5000 req/s. Beyond that, the API
CPU hits 100 % and requests queue in the pg pool (958 waiting at 7000 req/s), so E1 goes up to 6000 req/s
instead of the originally planned 1000.
