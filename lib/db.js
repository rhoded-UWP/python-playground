/**
 * Python Playground — Postgres connection for the usage dashboard.
 *
 * Reads DATABASE_URL from the environment. On Render, set it to the
 * database's *Internal* Database URL on the web service's Environment tab.
 *
 * If DATABASE_URL is not set (e.g. local development without Postgres),
 * analytics is simply turned off: record() becomes a no-op and the stats
 * route reports { enabled: false }. The rest of the site is unaffected.
 *
 * Privacy: the events table stores NO user identity — no IP address, no
 * user agent, no cookie or browser ID. Each row is one anonymous action
 * (a page view, a code run, a test run, a problem-set check).
 */

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
const enabled = Boolean(DATABASE_URL);

// Render's internal URL is on a private network and needs no TLS; the
// external URL (used from outside Render) requires it. Turn TLS on only
// for hosts that look external, or when PGSSL=require is set explicitly.
function sslFor(url) {
  if (process.env.PGSSL === 'disable') return false;
  if (process.env.PGSSL === 'require') return { rejectUnauthorized: false };
  try {
    const host = new URL(url).hostname;
    return host.includes('.') && host !== 'localhost' && host !== '127.0.0.1'
      ? { rejectUnauthorized: false }
      : false;
  } catch (e) {
    return false;
  }
}

const pool = enabled
  ? new Pool({ connectionString: DATABASE_URL, ssl: sslFor(DATABASE_URL), max: 5 })
  : null;

if (pool) {
  // An idle client erroring (e.g. the DB restarted) must not crash the app.
  pool.on('error', (err) => console.error(`Postgres pool error: ${err.message}`));
}

// Create the table and indexes if they don't exist. Safe to run on every
// start. `data` is JSONB so new event fields need no migration.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS events (
    id    BIGSERIAL PRIMARY KEY,
    ts    TIMESTAMPTZ NOT NULL DEFAULT now(),
    type  TEXT NOT NULL,
    page  TEXT,
    data  JSONB NOT NULL DEFAULT '{}'::jsonb
  );
  CREATE INDEX IF NOT EXISTS events_ts_idx      ON events (ts);
  CREATE INDEX IF NOT EXISTS events_type_ts_idx ON events (type, ts);
`;

let ready = null;
function migrate() {
  if (!pool) return Promise.resolve(false);
  if (!ready) {
    ready = pool
      .query(SCHEMA)
      .then(() => {
        console.log('Analytics: connected to Postgres, events table ready.');
        return true;
      })
      .catch((err) => {
        console.error(`Analytics: could not prepare database: ${err.message}`);
        ready = null; // allow a retry on the next call
        return false;
      });
  }
  return ready;
}

// Fire-and-forget insert. Analytics must never slow down or break a
// student's request, so errors are logged and swallowed.
function record(type, page, data) {
  if (!pool) return;
  migrate()
    .then((ok) => {
      if (!ok) return;
      return pool.query('INSERT INTO events (type, page, data) VALUES ($1, $2, $3)', [
        type,
        page || null,
        JSON.stringify(data || {}),
      ]);
    })
    .catch((err) => console.error(`Analytics insert failed: ${err.message}`));
}

function query(text, params) {
  return pool.query(text, params);
}

module.exports = { enabled, migrate, record, query, pool };
