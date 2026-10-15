import { app } from './app.js';
import { pool } from './db/pool.js';

const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port, () => console.log(`EventLoad API on :${port} (pool ${pool.options.max})`));
// Keep-alive must outlive the load generator's idle connections, or k6 sees resets.
server.keepAliveTimeout = 65_000;

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => server.close(() => pool.end().then(() => process.exit(0))));
}
