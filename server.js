/**
 * Python Playground — Express server
 *
 * Serves the static frontend from /public and provides a place to mount
 * future API routes (e.g. /api/run, /api/attendance, /api/problems).
 *
 * Render injects PORT into the environment — do not hard-code it.
 */

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
