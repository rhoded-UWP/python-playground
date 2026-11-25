/**
 * Python Playground — Usage analytics for the /dashboard page.
 *
 * Three ways data comes in:
 *   1. pageViews()  — Express middleware that counts real page loads
 *                     (HTML pages only, obvious bots skipped).
 *   2. POST /api/events — small beacons from the browser: code runs and
 *                     Test Code results from the Programming Playground.
 *   3. recordCheck() — called by the problem-set check route on the server,
 *                     so those results can't be faked from the browser.
 *
 * And one way out:
 *   GET /api/stats?days=7|30|90 — aggregated numbers for the dashboard.
 *
 * PRIVACY: nothing here stores who did something. No IP, no user agent,
 * no cookie, no browser ID. The client's IP is used only in memory for a
 * per-minute rate limit and is never written to the database. Student
 * identity is intentionally deferred until SSO exists.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const db = require('./db');
const loader = require('./loader');

// All day boundaries, day-of-week and hour-of-day use campus time.
const TZ = process.env.ANALYTICS_TZ || 'America/Chicago';
const ALLOWED_DAYS = [7, 30, 90];
const CACHE_MS = 60 * 1000;

/* ---- 1. Page views ---------------------------------------------------- */

const BOT_RE = /bot|crawl|spider|slurp|preview|monitor|uptime|headless|lighthouse|curl|wget|python-requests|render/i;

function pageViews(publicDir) {
  // Only count real pages that exist in /public, so the SPA fallback and
  // random 404 probes don't inflate the numbers.
  const pages = new Set(
    fs.readdirSync(publicDir).filter((f) => f.toLowerCase().endsWith('.html'))
  );

  return function (req, res, next) {
    if (req.method !== 'GET' || !db.enabled) return next();
    const file = req.path === '/' ? 'index.html' : req.path.replace(/^\//, '');
    if (!pages.has(file)) return next();
    if (BOT_RE.test(req.get('user-agent') || '')) return next();
    // Browsers' speculative prefetches aren't real visits.
    const purpose = req.get('sec-purpose') || req.get('purpose') || '';
    if (/prefetch/i.test(purpose)) return next();

    db.record('page_view', '/' + file, {});
    next();
  };
}

/* ---- 2. Browser events ------------------------------------------------ */

// Tiny in-memory limiter: N events per IP per minute. Keeps a script from
// flooding the table. The map is cleared every minute; IPs never persist.
const RATE_LIMIT = 120;
let rateWindow = new Map();
setInterval(() => (rateWindow = new Map()), 60 * 1000).unref();

function overLimit(ip) {
  const n = (rateWindow.get(ip) || 0) + 1;
  rateWindow.set(ip, n);
  return n > RATE_LIMIT;
}

function cleanStr(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, max);
  return s || null;
}
function cleanInt(v, max) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}

// Whitelist of event types the browser may send, and how to sanitize each.
// Anything not listed here is dropped.
const EVENT_TYPES = {
  // Run button. new_lines = non-blank lines added since this page load's
  // previous high-water mark for this assignment (see playground.js).
  code_run(d) {
    const errorType = cleanStr(d.error_type, 40);
    return {
      assignment: cleanStr(d.assignment, 64),
      ok: d.ok === true,
      error_type: errorType && /^[A-Za-z_]+$/.test(errorType) ? errorType : null,
      lines: cleanInt(d.lines, 5000),
      new_lines: cleanInt(d.new_lines, 500),
    };
  },
  // Test Code button. first_pass is true only the first time this browser
  // passes every test for this assignment (a local flag, not an identity).
  code_test(d) {
    const total = cleanInt(d.total, 100);
    const passed = Math.min(cleanInt(d.passed, 100), total);
    return {
      assignment: cleanStr(d.assignment, 64),
      passed,
      total,
      all_passed: total > 0 && passed === total,
      first_pass: total > 0 && passed === total && d.first_pass === true,
      lines: cleanInt(d.lines, 5000),
      new_lines: cleanInt(d.new_lines, 500),
    };
  },
};

/* ---- 3. Server-side problem-set checks -------------------------------- */

function recordCheck(setId, partId, rowId, field, correct) {
  db.record('ps_check', '/problem-sets.html', {
    set: String(setId).slice(0, 64),
    part: String(partId).slice(0, 64),
    row: String(rowId).slice(0, 32),
    field: String(field).slice(0, 32),
    correct: Boolean(correct),
  });
}

/* ---- Stats ------------------------------------------------------------ */

// $1 = time zone, $2 = number of days. The window starts at local midnight
// (days - 1) days ago, so "7 days" is today plus the six days before it.
const START = `(((now() AT TIME ZONE $1)::date - ($2::int - 1))::timestamp AT TIME ZONE $1)`;
const PREV_START = `(((now() AT TIME ZONE $1)::date - (2 * $2::int - 1))::timestamp AT TIME ZONE $1)`;
const LINES = `COALESCE((data->>'new_lines')::int, 0)`;
const CODE = `type IN ('code_run', 'code_test')`;

const SQL = {
  // Range totals, plus the same totals for the previous range for deltas.
  totals: `
    SELECT (ts >= ${START}) AS current,
      count(*) FILTER (WHERE type = 'page_view')                                      AS views,
      count(*) FILTER (WHERE type = 'code_run')                                       AS runs,
      count(*) FILTER (WHERE type = 'code_test')                                      AS tests,
      count(*) FILTER (WHERE type = 'code_test' AND (data->>'first_pass')::boolean)    AS completions,
      COALESCE(sum(${LINES}) FILTER (WHERE ${CODE}), 0)                               AS lines,
      count(*) FILTER (WHERE type = 'ps_check')                                       AS checks,
      count(*) FILTER (WHERE type = 'ps_check' AND (data->>'correct')::boolean)        AS checks_correct
    FROM events
    WHERE ts >= ${PREV_START}
    GROUP BY 1`,

  // Lines of code: today / last 7 days / last 30 days / all time,
  // independent of the selected range.
  lines: `
    SELECT
      COALESCE(sum(${LINES}) FILTER (WHERE ts >= (((now() AT TIME ZONE $1)::date)::timestamp AT TIME ZONE $1)), 0) AS today,
      COALESCE(sum(${LINES}) FILTER (WHERE ts >= (((now() AT TIME ZONE $1)::date - 6)::timestamp AT TIME ZONE $1)), 0) AS week,
      COALESCE(sum(${LINES}) FILTER (WHERE ts >= (((now() AT TIME ZONE $1)::date - 29)::timestamp AT TIME ZONE $1)), 0) AS month,
      COALESCE(sum(${LINES}), 0) AS all_time,
      count(*) FILTER (WHERE type = 'code_test' AND (data->>'first_pass')::boolean) AS completions_all_time,
      count(*) FILTER (WHERE type = 'code_run') AS runs_all_time
    FROM events WHERE ${CODE}`,

  // One row per local day in the range, zero-filled.
  daily: `
    WITH days AS (
      SELECT generate_series((now() AT TIME ZONE $1)::date - ($2::int - 1),
                             (now() AT TIME ZONE $1)::date, interval '1 day')::date AS d
    ), agg AS (
      SELECT (ts AT TIME ZONE $1)::date AS d,
        count(*) FILTER (WHERE type = 'page_view')                                   AS views,
        count(*) FILTER (WHERE type = 'code_run')                                    AS runs,
        count(*) FILTER (WHERE type = 'code_test' AND (data->>'first_pass')::boolean) AS completions,
        COALESCE(sum(${LINES}) FILTER (WHERE ${CODE}), 0)                            AS lines,
        count(*) FILTER (WHERE type = 'ps_check')                                    AS checks
      FROM events WHERE ts >= ${START}
      GROUP BY 1
    )
    SELECT to_char(days.d, 'YYYY-MM-DD') AS day,
      COALESCE(views, 0) AS views, COALESCE(runs, 0) AS runs,
      COALESCE(completions, 0) AS completions, COALESCE(lines, 0) AS lines,
      COALESCE(checks, 0) AS checks
    FROM days LEFT JOIN agg USING (d)
    ORDER BY days.d`,

  pages: `
    SELECT page, count(*) AS views FROM events
    WHERE type = 'page_view' AND ts >= ${START}
    GROUP BY page ORDER BY views DESC LIMIT 10`,

  assignments: `
    SELECT data->>'assignment' AS assignment,
      count(*) FILTER (WHERE type = 'code_run')                                       AS runs,
      count(*) FILTER (WHERE type = 'code_test')                                      AS tests,
      count(*) FILTER (WHERE type = 'code_test' AND (data->>'all_passed')::boolean)    AS passing_tests,
      count(*) FILTER (WHERE type = 'code_test' AND (data->>'first_pass')::boolean)    AS completions,
      COALESCE(sum(${LINES}), 0)                                                      AS lines
    FROM events
    WHERE ${CODE} AND ts >= ${START} AND data->>'assignment' IS NOT NULL
    GROUP BY 1`,

  // Problem-set lines students miss most (needs a few attempts to rank).
  missed: `
    SELECT data->>'set' AS set, data->>'part' AS part, data->>'row' AS row,
      count(*) AS attempts,
      count(*) FILTER (WHERE NOT (data->>'correct')::boolean) AS misses
    FROM events
    WHERE type = 'ps_check' AND ts >= ${START}
    GROUP BY 1, 2, 3
    HAVING count(*) >= 3 AND count(*) FILTER (WHERE NOT (data->>'correct')::boolean) > 0
    ORDER BY (count(*) FILTER (WHERE NOT (data->>'correct')::boolean))::float / count(*) DESC,
             count(*) DESC
    LIMIT 8`,

  errors: `
    SELECT data->>'error_type' AS error, count(*) AS n FROM events
    WHERE type = 'code_run' AND data->>'error_type' IS NOT NULL AND ts >= ${START}
    GROUP BY 1 ORDER BY n DESC LIMIT 8`,

  // Coding activity by local weekday (1 = Mon) and hour.
  heatmap: `
    SELECT extract(isodow FROM ts AT TIME ZONE $1)::int AS dow,
           extract(hour   FROM ts AT TIME ZONE $1)::int AS hour,
           count(*) AS n
    FROM events
    WHERE type IN ('code_run', 'code_test', 'ps_check') AND ts >= ${START}
    GROUP BY 1, 2`,
};

// Friendly names for assignments and problem-set lines, read from the same
// files the site already uses. Failures just fall back to raw ids.
function assignmentNames() {
  const dir = path.join(__dirname, '..', 'public', 'assignments');
  const names = {};
  try {
    fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .forEach((f, i) => {
        try {
          const a = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          if (a.id) names[a.id] = { name: a.name || a.id, order: i + 1 };
        } catch (e) { /* skip malformed file */ }
      });
  } catch (e) { /* folder missing */ }
  return names;
}

function describeRow(setId, partId, rowId) {
  try {
    const set = loader.getPublicSet(setId);
    if (!set) return { setTitle: setId, part: partId, snippet: null };
    const part = set.parts.find((p) => p.id === partId);
    const row = part && part.rows.find((r) => String(r.id) === String(rowId));
    const text = row && (row.code || row.prompt || row.text || row.value);
    return {
      setTitle: set.title,
      part: (part && part.part) || partId,
      snippet: typeof text === 'string' ? text.slice(0, 80) : null,
    };
  } catch (e) {
    return { setTitle: setId, part: partId, snippet: null };
  }
}

const num = (v) => Number(v) || 0;
const cache = new Map();

async function buildStats(days) {
  const p = [TZ, days];
  const [totals, lines, daily, pages, assignments, missed, errors, heatmap] =
    await Promise.all([
      db.query(SQL.totals, p),
      db.query(SQL.lines, [TZ]),
      db.query(SQL.daily, p),
      db.query(SQL.pages, p),
      db.query(SQL.assignments, p),
      db.query(SQL.missed, p),
      db.query(SQL.errors, p),
      db.query(SQL.heatmap, p),
    ]);

  const pickTotals = (current) => {
    const row = totals.rows.find((r) => r.current === current) || {};
    return {
      views: num(row.views),
      runs: num(row.runs),
      tests: num(row.tests),
      completions: num(row.completions),
      lines: num(row.lines),
      checks: num(row.checks),
      checksCorrect: num(row.checks_correct),
    };
  };

  const names = assignmentNames();
  const L = lines.rows[0] || {};

  return {
    enabled: true,
    generatedAt: new Date().toISOString(),
    timeZone: TZ,
    days,
    totals: pickTotals(true),
    previous: pickTotals(false),
    lines: {
      today: num(L.today),
      week: num(L.week),
      month: num(L.month),
      allTime: num(L.all_time),
    },
    allTime: {
      completions: num(L.completions_all_time),
      runs: num(L.runs_all_time),
    },
    daily: daily.rows.map((r) => ({
      day: r.day,
      views: num(r.views),
      runs: num(r.runs),
      completions: num(r.completions),
      lines: num(r.lines),
      checks: num(r.checks),
    })),
    pages: pages.rows.map((r) => ({ page: r.page, views: num(r.views) })),
    assignments: assignments.rows
      .map((r) => {
        const meta = names[r.assignment] || { name: r.assignment, order: 999 };
        return {
          id: r.assignment,
          name: meta.name,
          order: meta.order,
          runs: num(r.runs),
          tests: num(r.tests),
          passingTests: num(r.passing_tests),
          completions: num(r.completions),
          lines: num(r.lines),
        };
      })
      .sort((a, b) => a.order - b.order),
    missed: missed.rows.map((r) => ({
      ...describeRow(r.set, r.part, r.row),
      row: r.row,
      attempts: num(r.attempts),
      misses: num(r.misses),
    })),
    errors: errors.rows.map((r) => ({ error: r.error, count: num(r.n) })),
    heatmap: heatmap.rows.map((r) => ({ dow: r.dow, hour: r.hour, count: num(r.n) })),
  };
}

/* ---- Router ----------------------------------------------------------- */

const router = express.Router();

router.post('/api/events', express.json({ limit: '4kb' }), (req, res) => {
  // Always answer 204 quickly; the browser doesn't wait on this.
  res.status(204).end();
  if (!db.enabled || overLimit(req.ip)) return;

  const body = req.body || {};
  const clean = EVENT_TYPES[body.type];
  if (!clean) return;
  const page = cleanStr(body.page, 80);
  db.record(body.type, page && /^\/[\w\-./]*$/.test(page) ? page : null, clean(body.data || {}));
});

router.get('/api/stats', async (req, res) => {
  if (!db.enabled) return res.json({ enabled: false });

  const asked = parseInt(req.query.days, 10);
  const days = ALLOWED_DAYS.includes(asked) ? asked : 30;

  const hit = cache.get(days);
  if (hit && Date.now() - hit.at < CACHE_MS) return res.json(hit.body);

  try {
    await db.migrate();
    const body = await buildStats(days);
    cache.set(days, { at: Date.now(), body });
    res.json(body);
  } catch (err) {
    console.error(`GET /api/stats failed: ${err.message}`);
    res.status(500).json({ error: 'Could not load stats.' });
  }
});

module.exports = { router, pageViews, recordCheck };
