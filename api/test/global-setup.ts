import pg from 'pg';

// Fresh copy of the seeded template before every test run, so tests are repeatable.
export default async function setup() {
  const admin = new pg.Client('postgres://eventload:eventload@localhost:55432/postgres');
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS eventload_test WITH (FORCE)');
  await admin.query('CREATE DATABASE eventload_test TEMPLATE eventload_seed');
  await admin.end();
}
