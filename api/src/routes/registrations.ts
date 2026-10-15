import { Router } from 'express';
import { pool } from '../db/pool.js';
import { HttpError, positiveInt } from '../http.js';

export const registrations = Router();

// POST /api/events/:id/register  { userId }
// One transaction: atomically take a seat (row lock on the event), then insert the registration.
// 409 when the event is full or the user is already registered.
registrations.post('/events/:id/register', async (req, res) => {
  const eventId = positiveInt(req.params.id, 'id');
  const userId = positiveInt(req.body?.userId, 'userId');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const seat = await client.query(
      `UPDATE events SET registered_count = registered_count + 1
       WHERE id = $1 AND registered_count < capacity RETURNING registered_count, capacity`,
      [eventId],
    );
    if (!seat.rows[0]) {
      await client.query('ROLLBACK');
      // Reuse this client: asking the pool for a second connection while holding one deadlocks under load.
      const exists = await client.query('SELECT 1 FROM events WHERE id = $1', [eventId]);
      throw exists.rowCount ? new HttpError(409, 'event is full') : new HttpError(404, 'event not found');
    }
    const { rows } = await client.query(
      `INSERT INTO registrations (user_id, event_id) VALUES ($1, $2)
       ON CONFLICT (user_id, event_id) DO NOTHING RETURNING id, user_id, event_id, created_at`,
      [userId, eventId],
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      throw new HttpError(409, 'already registered');
    }
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err: any) {
    if (!(err instanceof HttpError)) await client.query('ROLLBACK').catch(() => {});
    if (err?.code === '23503') throw new HttpError(404, 'user not found');
    throw err;
  } finally {
    client.release();
  }
});

// GET /api/events/:id/registrations  (JOIN with users, up to a few hundred rows of JSON)
registrations.get('/events/:id/registrations', async (req, res) => {
  const eventId = positiveInt(req.params.id, 'id');
  const { rows } = await pool.query(
    `SELECT r.id, r.created_at, u.id AS user_id, u.name, u.email
     FROM registrations r JOIN users u ON u.id = r.user_id
     WHERE r.event_id = $1 ORDER BY r.id`,
    [eventId],
  );
  res.json({ eventId, count: rows.length, data: rows });
});

// GET /api/stats/categories  (aggregate over all 50k registrations: DB-heavy)
registrations.get('/stats/categories', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT c.slug, count(DISTINCT e.id)::int AS events, count(r.id)::int AS registrations,
            round(avg(e.capacity))::int AS avg_capacity
     FROM categories c
     JOIN events e ON e.category_id = c.id
     LEFT JOIN registrations r ON r.event_id = e.id
     GROUP BY c.slug ORDER BY registrations DESC`,
  );
  res.json({ data: rows });
});
