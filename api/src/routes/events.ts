import { Router } from 'express';
import { pool } from '../db/pool.js';
import { HttpError, positiveInt } from '../http.js';

export const events = Router();

const EVENT_COLUMNS = `e.id, e.title, e.description, e.location, e.capacity, e.registered_count,
  e.start_date, e.created_at, c.slug AS category`;

// GET /api/events?page=&limit=&category=  (paginated list, optional category filter)
events.get('/', async (req, res) => {
  const page = positiveInt(req.query.page, 'page', 1);
  const limit = Math.min(positiveInt(req.query.limit, 'limit', 20), 100);
  const category = typeof req.query.category === 'string' ? req.query.category : null;

  const where = category ? 'WHERE c.slug = $3' : '';
  const params: unknown[] = [limit, (page - 1) * limit];
  if (category) params.push(category);

  const [rows, total] = await Promise.all([
    pool.query(
      `SELECT ${EVENT_COLUMNS} FROM events e JOIN categories c ON c.id = e.category_id
       ${where} ORDER BY e.start_date, e.id LIMIT $1 OFFSET $2`,
      params,
    ),
    pool.query(
      `SELECT count(*)::int AS total FROM events e JOIN categories c ON c.id = e.category_id
       ${category ? 'WHERE c.slug = $1' : ''}`,
      category ? [category] : [],
    ),
  ]);
  res.json({ page, limit, total: total.rows[0].total, data: rows.rows });
});

// GET /api/events/search?q=  (ILIKE over title + description: no index can help, full scan)
events.get('/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 2) throw new HttpError(400, 'q must be at least 2 characters');
  const { rows } = await pool.query(
    `SELECT ${EVENT_COLUMNS} FROM events e JOIN categories c ON c.id = e.category_id
     WHERE e.title ILIKE $1 OR e.description ILIKE $1 ORDER BY e.start_date LIMIT 50`,
    [`%${q}%`],
  );
  res.json({ q, count: rows.length, data: rows });
});

events.get('/:id', async (req, res) => {
  const id = positiveInt(req.params.id, 'id');
  const { rows } = await pool.query(
    `SELECT ${EVENT_COLUMNS} FROM events e JOIN categories c ON c.id = e.category_id WHERE e.id = $1`,
    [id],
  );
  if (!rows[0]) throw new HttpError(404, 'event not found');
  res.json(rows[0]);
});

function parseEventBody(body: any) {
  const { title, description = '', location, capacity, categoryId, startDate } = body ?? {};
  if (typeof title !== 'string' || !title.trim()) throw new HttpError(400, 'title is required');
  if (typeof location !== 'string' || !location.trim()) throw new HttpError(400, 'location is required');
  if (typeof startDate !== 'string' || Number.isNaN(Date.parse(startDate)))
    throw new HttpError(400, 'startDate must be an ISO date');
  return {
    title,
    description: String(description),
    location,
    capacity: positiveInt(capacity, 'capacity'),
    categoryId: positiveInt(categoryId, 'categoryId'),
    startDate,
  };
}

events.post('/', async (req, res) => {
  const e = parseEventBody(req.body);
  const { rows } = await pool.query(
    `INSERT INTO events (title, description, location, capacity, category_id, start_date)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, title, capacity, registered_count, start_date`,
    [e.title, e.description, e.location, e.capacity, e.categoryId, e.startDate],
  );
  res.status(201).json(rows[0]);
});

events.put('/:id', async (req, res) => {
  const id = positiveInt(req.params.id, 'id');
  const e = parseEventBody(req.body);
  const { rows } = await pool.query(
    `UPDATE events SET title=$2, description=$3, location=$4, capacity=$5, category_id=$6, start_date=$7
     WHERE id = $1 RETURNING id, title, capacity, registered_count, start_date`,
    [id, e.title, e.description, e.location, e.capacity, e.categoryId, e.startDate],
  );
  if (!rows[0]) throw new HttpError(404, 'event not found');
  res.json(rows[0]);
});

events.delete('/:id', async (req, res) => {
  const id = positiveInt(req.params.id, 'id');
  const { rowCount } = await pool.query('DELETE FROM events WHERE id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'event not found');
  res.status(204).end();
});
