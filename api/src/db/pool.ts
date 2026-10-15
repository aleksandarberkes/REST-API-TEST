import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://eventload:eventload@localhost:55432/eventload',
  max: Number(process.env.POOL_SIZE ?? 10),
  // Fail fast instead of queueing forever when the pool is exhausted under load.
  connectionTimeoutMillis: 10_000,
});
