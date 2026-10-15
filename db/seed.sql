-- Deterministic seed: 20 categories, 10 000 users, 1 000 events, 50 000 registrations.
-- setseed() makes random() repeatable, so every reset produces the identical dataset.
SELECT setseed(0.42) AS _seed \gset

INSERT INTO categories (name, slug)
SELECT initcap(s), s FROM unnest(ARRAY[
  'technology','music','sports','business','science','art','education','health',
  'food','travel','gaming','film','literature','fashion','photography','design',
  'finance','environment','startups','networking']) AS s;

INSERT INTO users (name, email)
SELECT 'User ' || g, 'user' || g || '@example.com' FROM generate_series(1, 10000) g;

INSERT INTO events (title, description, location, category_id, capacity, start_date)
SELECT
  'Event ' || g || ' ' || (ARRAY['Meetup','Conference','Workshop','Hackathon','Concert','Seminar'])[1 + g % 6],
  repeat('Lorem ipsum dolor sit amet, consectetur adipiscing elit. ', 4)
    || (ARRAY['cloud','kubernetes','jazz','football','startup','python','design','marathon'])[1 + g % 8],
  (ARRAY['Novi Sad','Beograd','Subotica','Nis','Kragujevac'])[1 + g % 5],
  1 + (g % 20),
  100 + floor(random() * 400)::int,
  timestamptz '2026-11-01' + (g || ' hours')::interval
FROM generate_series(1, 1000) g;

-- Every user registers for 5 different events: (u*7 + j*131) mod 1000 is unique per user for j < 5.
INSERT INTO registrations (user_id, event_id)
SELECT u, 1 + ((u * 7 + j * 131) % 1000)
FROM generate_series(1, 10000) u, generate_series(0, 4) j;

UPDATE events e SET registered_count = r.c
FROM (SELECT event_id, count(*)::int c FROM registrations GROUP BY event_id) r
WHERE r.event_id = e.id;

ANALYZE;
