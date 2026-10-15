import express, { type ErrorRequestHandler } from 'express';
import { readFileSync } from 'node:fs';
import { HttpError } from './http.js';
import { countRequests } from './metrics.js';
import { events } from './routes/events.js';
import { internal } from './routes/internal.js';
import { registrations } from './routes/registrations.js';

export const app = express();
app.disable('x-powered-by');
app.disable('etag');
app.use(countRequests);
app.use(express.json());

app.use(internal);
app.use('/api/events', events);
app.use('/api', registrations);

app.get('/openapi.yaml', (_req, res) => {
  res.type('text/yaml').send(readFileSync(new URL('../openapi.yaml', import.meta.url)));
});
app.get('/docs', (_req, res) => {
  res.type('html').send(`<!doctype html><html><head><title>EventLoad API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css"></head>
<body><div id="ui"></div><script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: '/openapi.yaml', dom_id: '#ui' })</script></body></html>`);
});

app.use((_req, res) => {
  res.status(404).json({ error: 'not found' });
});

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'internal error' });
};
app.use(onError);
