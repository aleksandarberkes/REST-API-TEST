-- EventLoad schema. Loaded into the template database `eventload_seed`.
CREATE TABLE categories (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL,
  slug  TEXT NOT NULL UNIQUE
);

CREATE TABLE users (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id               SERIAL PRIMARY KEY,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL,
  location         TEXT NOT NULL,
  category_id      INT NOT NULL REFERENCES categories(id),
  capacity         INT NOT NULL CHECK (capacity > 0),
  registered_count INT NOT NULL DEFAULT 0 CHECK (registered_count <= capacity),
  start_date       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX events_category_idx ON events(category_id);
CREATE INDEX events_start_date_idx ON events(start_date, id);

CREATE TABLE registrations (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id),
  event_id   INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_id)
);
CREATE INDEX registrations_event_idx ON registrations(event_id);
