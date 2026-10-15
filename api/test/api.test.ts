// Functional tests. Need the Docker DB running and the test database created:
//   npm run setup   (creates the eventload_seed template; global-setup copies it)
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

process.env.DATABASE_URL ??= 'postgres://eventload:eventload@localhost:55432/eventload_test';
const { app } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');

afterAll(() => pool.end());

describe('reads', () => {
  it('health', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });

  it('event by id / 404 / 400', async () => {
    expect((await request(app).get('/api/events/1')).body).toMatchObject({ id: 1 });
    expect((await request(app).get('/api/events/999999')).status).toBe(404);
    expect((await request(app).get('/api/events/abc')).status).toBe(400);
  });

  it('pagination and category filter', async () => {
    const page = await request(app).get('/api/events?page=2&limit=10');
    expect(page.body.data).toHaveLength(10);
    expect(page.body.total).toBeGreaterThanOrEqual(1000);
    const cat = await request(app).get('/api/events?category=technology&limit=100');
    expect(cat.body.data.every((e: any) => e.category === 'technology')).toBe(true);
    expect(cat.body.total).toBe(50);
  });

  it('search, registrations, stats', async () => {
    expect((await request(app).get('/api/events/search?q=jazz')).body.count).toBeGreaterThan(0);
    expect((await request(app).get('/api/events/search?q=a')).status).toBe(400);
    expect((await request(app).get('/api/events/1/registrations')).body.count).toBeGreaterThan(0);
    expect((await request(app).get('/api/stats/categories')).body.data).toHaveLength(20);
  });

  it('metrics snapshot', async () => {
    const res = await request(app).get('/internal/metrics');
    expect(res.body).toHaveProperty('eventLoopLagMs.p99');
    expect(res.body).toHaveProperty('pool.waiting');
  });
});

describe('writes', () => {
  const newEvent = (capacity: number) =>
    request(app).post('/api/events').send({
      title: 'Test event', location: 'Novi Sad', capacity, categoryId: 1, startDate: '2026-12-01T18:00:00Z',
    });

  it('validates input', async () => {
    expect((await request(app).post('/api/events').send({ title: 'x' })).status).toBe(400);
  });

  it('register, duplicate, full', async () => {
    const { body: ev } = await newEvent(1);
    expect((await request(app).post(`/api/events/${ev.id}/register`).send({ userId: 1 })).status).toBe(201);
    expect((await request(app).post(`/api/events/${ev.id}/register`).send({ userId: 1 })).status).toBe(409);
    const full = await request(app).post(`/api/events/${ev.id}/register`).send({ userId: 2 });
    expect(full.status).toBe(409);
    expect(full.body.error).toMatch(/full/);
  });

  it('duplicate registration does not consume a seat', async () => {
    const { body: ev } = await newEvent(2);
    await request(app).post(`/api/events/${ev.id}/register`).send({ userId: 1 });
    await request(app).post(`/api/events/${ev.id}/register`).send({ userId: 1 });
    expect((await request(app).post(`/api/events/${ev.id}/register`).send({ userId: 2 })).status).toBe(201);
  });

  it('concurrent registrations never exceed capacity', async () => {
    const { body: ev } = await newEvent(20);
    const results = await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        request(app).post(`/api/events/${ev.id}/register`).send({ userId: 100 + i }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(20);
    expect(results.filter((r) => r.status === 409)).toHaveLength(40);
    const after = await request(app).get(`/api/events/${ev.id}/registrations`);
    expect(after.body.count).toBe(20);
  });

  it('update and delete', async () => {
    const { body: ev } = await newEvent(5);
    const put = await request(app).put(`/api/events/${ev.id}`).send({
      title: 'Renamed', location: 'Beograd', capacity: 6, categoryId: 2, startDate: '2026-12-02T18:00:00Z',
    });
    expect(put.body.title).toBe('Renamed');
    expect((await request(app).delete(`/api/events/${ev.id}`)).status).toBe(204);
    expect((await request(app).get(`/api/events/${ev.id}`)).status).toBe(404);
  });
});
