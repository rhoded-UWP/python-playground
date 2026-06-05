/**
 * Python Playground — Express server
 *
 * Serves the static frontend from /public and provides a place to mount
 * future API routes (e.g. /api/run, /api/attendance, /api/problems).
 *
 * Render injects PORT into the environment — do not hard-code it.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');

// Problem Sets: the loader reads the server-only /problem-sets folder and
// builds answer-free "public shapes"; the validator is the single place the
// "is this correct?" rule lives. Both run on the server only, so correct
// answers never travel to the browser.
const loader = require('./lib/loader');
const validator = require('./lib/validator');

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies for future API endpoints.
app.use(express.json());

// Serve static assets (HTML, CSS, JS, images) from /public.
app.use(express.static(path.join(__dirname, 'public')));

// --- API routes ---------------------------------------------------------
// Future API endpoints get mounted here. Example:
//   app.use('/api/problems', require('./routes/problems'));

// Simple health check Render can ping.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'python-playground' });
});

// Assignments for the Python Programming Playground. Each assignment is its
// own JSON file in /public/assignments. This route reads the folder fresh on
// every request and returns the parsed files in filename order, so adding an
// assignment is just dropping a new numbered .json file in there — no code
// change and no restart needed. A malformed file is skipped (and logged) so
// one typo can't take the whole page down. See that folder's README.md for
// the file schema.
const ASSIGNMENTS_DIR = path.join(__dirname, 'public', 'assignments');
app.get('/api/assignments', (req, res) => {
  let files;
  try {
    files = fs
      .readdirSync(ASSIGNMENTS_DIR)
      .filter((name) => name.toLowerCase().endsWith('.json'))
      .sort(); // filename order — use 01-, 02-, ... prefixes to control it
  } catch (err) {
    console.error(`Could not read assignments folder: ${err.message}`);
    return res.status(500).json({ error: 'Could not read assignments folder.' });
  }

  const assignments = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(ASSIGNMENTS_DIR, file), 'utf8');
      assignments.push(JSON.parse(raw));
    } catch (err) {
      console.error(`Skipping assignment "${file}": ${err.message}`);
    }
  }

  res.json({ assignments });
});

// --- Problem Sets API ---------------------------------------------------
// The data files live in /problem-sets, OUTSIDE the static /public folder,
// so they are never served wholesale. The browser only ever receives the
// answer-free "public shape" and per-line verdicts. See lib/loader.js.

// List the available sets for the rail: ids, titles, ordering, point
// totals. No rows and no answers.
app.get('/api/sets', (req, res) => {
  try {
    res.json({ sets: loader.listSets() });
  } catch (err) {
    console.error(`GET /api/sets failed: ${err.message}`);
    res.status(500).json({ error: 'Could not list problem sets.' });
  }
});

// The public shape of one set: metadata plus every part's rows with prompts
// and snippets, but NO answers. This is what the page renders from.
app.get('/api/sets/:setId', (req, res) => {
  try {
    const set = loader.getPublicSet(req.params.setId);
    if (!set) return res.status(404).json({ error: 'Unknown problem set.' });
    res.json(set);
  } catch (err) {
    console.error(`GET /api/sets/${req.params.setId} failed: ${err.message}`);
    res.status(500).json({ error: 'Could not load that problem set.' });
  }
});

// Check ONE submitted answer. Body: { partId, rowId, field, value }.
// The server looks the correct answer up from disk and compares with the
// single validator function, trusting nothing the client sent except the
// submitted value. Returns { correct, feedback? } and never the answer.
//
// FUTURE (intentionally not built yet): SSO token auth would guard this
// route, and a sibling route could persist the score for Canvas LTI 1.3
// grade passback. Scoring already lives in lib/validator.js so that future
// route can reuse it instead of re-implementing the comparison here.
app.post('/api/sets/:setId/check', (req, res) => {
  const { partId, rowId, field } = req.body || {};
  const value = req.body ? req.body.value : undefined;

  if (!partId || rowId === undefined || !field) {
    return res.status(400).json({ error: 'Expected partId, rowId, and field.' });
  }

  try {
    const lookup = loader.getExpected(req.params.setId, partId, rowId, field);
    if (!lookup.found) {
      return res.status(404).json({ error: 'Unknown row or field.' });
    }

    const correct = validator.isCorrect(lookup.expected, value);
    const body = { correct };
    // Only ever send a hint, never the answer, and only when wrong.
    if (!correct && lookup.hint) body.feedback = lookup.hint;
    res.json(body);
  } catch (err) {
    console.error(`POST /api/sets/${req.params.setId}/check failed: ${err.message}`);
    res.status(500).json({ error: 'Could not check that answer.' });
  }
});

// --- SPA-style fallback for unknown routes ------------------------------
// Sends the home page for any unmatched GET so deep links don't 404 during
// development. Adjust once you add real client-side routing.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Python Playground listening on port ${PORT}`);
  loader.warmup(); // log how many problem-set files loaded (helps catch typos)
});
