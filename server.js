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

// --- SPA-style fallback for unknown routes ------------------------------
// Sends the home page for any unmatched GET so deep links don't 404 during
// development. Adjust once you add real client-side routing.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Python Playground listening on port ${PORT}`);
});
