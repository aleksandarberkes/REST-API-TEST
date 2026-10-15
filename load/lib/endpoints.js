// One request function per target. Each request is tagged with a stable `name`
// so URLs with random ids are grouped into one metric series.
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const CATEGORIES = [
  'technology', 'music', 'sports', 'business', 'science', 'art', 'education', 'health',
  'food', 'travel', 'gaming', 'film', 'literature', 'fashion', 'photography', 'design',
  'finance', 'environment', 'startups', 'networking',
];
const WORDS = ['cloud', 'kubernetes', 'jazz', 'football', 'startup', 'python', 'design', 'marathon'];

// Seeded data ranges (db/seed.sql).
const USERS = 10000;
const EVENTS = 1000;

const rnd = (n) => 1 + Math.floor(Math.random() * n);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
// 409 (full / already registered) is a valid business answer for writes, not a failure.
const writeOk = http.expectedStatuses(201, 409);
const params = (name, extra = {}) => ({ tags: { name }, timeout: '10s', ...extra });

function ok(res, statuses) {
  check(res, { 'status is expected': (r) => statuses.includes(r.status) });
  return res;
}

const get = (name, url) => ok(http.get(`${BASE}${url}`, params(name)), [200]);

function register(eventId, name = 'register') {
  const res = http.post(
    `${BASE}/api/events/${eventId}/register`,
    JSON.stringify({ userId: rnd(USERS) }),
    params(name, { headers: JSON_HEADERS, responseCallback: writeOk }),
  );
  return ok(res, [201, 409]);
}

export const requests = {
  health: () => get('health', '/api/health'),
  'event-by-id': () => get('event-by-id', `/api/events/${rnd(EVENTS)}`),
  'events-page': () => get('events-page', `/api/events?page=${rnd(50)}&limit=20`),
  'events-category': () => get('events-category', `/api/events?category=${pick(CATEGORIES)}`),
  'events-search': () => get('events-search', `/api/events/search?q=${pick(WORDS)}`),
  'event-registrations': () => get('event-registrations', `/api/events/${rnd(EVENTS)}/registrations`),
  'category-stats': () => get('category-stats', '/api/stats/categories'),
  'create-event': () =>
    ok(
      http.post(`${BASE}/api/events`, JSON.stringify(newEvent(rnd(400))), params('create-event', { headers: JSON_HEADERS })),
      [201],
    ),
  register: () => register(rnd(EVENTS)),
  'hot-event-rush': (data) => register(data.hotEventId, 'hot-event-rush'),
};

const READS = ['event-by-id', 'events-page', 'events-category'];

/** Weighted read/write mix: `mix.read` percent of iterations are a random read, the rest register. */
export function mixed(mix) {
  return Math.random() * 100 < mix.read ? requests[pick(READS)]() : requests.register();
}

export function newEvent(capacity) {
  return {
    title: `Load test event ${Date.now()}`,
    description: 'Created by k6',
    location: 'Novi Sad',
    capacity,
    categoryId: rnd(CATEGORIES.length),
    startDate: '2026-12-01T18:00:00Z',
  };
}

// Load requests discard bodies (discardResponseBodies) to keep k6 light; setup/teardown need them.
const KEEP_BODY = { responseType: 'text' };

export function createHotEvent(capacity) {
  const res = http.post(`${BASE}/api/events`, JSON.stringify(newEvent(capacity)), { headers: JSON_HEADERS, ...KEEP_BODY });
  if (res.status !== 201) throw new Error(`could not create hot event: ${res.status} ${res.body}`);
  return res.json('id');
}

export function getEvent(id) {
  return http.get(`${BASE}/api/events/${id}`, KEEP_BODY).json();
}
