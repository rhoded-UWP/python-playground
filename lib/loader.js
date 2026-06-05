/* =========================================================
   Problem Sets - loader and public-shape builder (server-side only)

   Responsibilities:
   1. Read the problem-set JSON files from /problem-sets (which lives
      OUTSIDE /public, so the static server never hands them out).
   2. Group the files into "sets". One file is one PART of a set; parts
      that share a "setId" are grouped together (this is how PS2's five
      sheets become one "PS 2" entry in the rail).
   3. Build the PUBLIC SHAPE that the browser is allowed to see, by
      copying ONLY known display fields. Answers are never copied in, so
      they cannot reach the client even if someone adds a new field to a
      file later. This whitelist is the core of the "answers never reach
      the client" requirement.
   4. Look up the correct answer for one field when the server checks a
      submitted answer. This is the ONLY path that reads answer values,
      and it only ever runs on the server.

   The folder is read fresh on every call, so publishing a new problem
   set is just dropping a JSON file in /problem-sets. No restart needed,
   matching how /api/assignments already works.
   ========================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

// /problem-sets at the project root. NOT under /public on purpose.
const SETS_DIR = path.join(__dirname, '..', 'problem-sets');

// Coerce any JSON value to a display string. Numbers in the JSON (like 7)
// become "7" so they line up with the text a student types.
function str(v) {
  return v === undefined || v === null ? '' : String(v);
}

/* ---- Problem-set types ---------------------------------------------------

   Each supported "type" describes three things in one place:
     fields(part)      which answer fields a row is graded on, in order
     expected(row, f)  the correct value for field f of a row (server only)
     publicRow(row)    the safe, answer-free version of a row for the client

   To add a new problem-set type, add one entry here and one renderer in
   public/js/problem-set.js. Nothing else needs to change.
-------------------------------------------------------------------------- */
const TYPES = {
  // One Python snippet per row; student types the printed output.
  'predict-output': {
    fields: () => ['answer'],
    expected: (row) => row.answer,
    publicRow: (row) => ({ id: str(row.id), code: str(row.code) }),
  },

  // Student marks Valid/Invalid AND picks the data type.
  'valid-invalid-type': {
    fields: () => ['validity', 'dataType'],
    expected: (row, field) => (row.answers ? row.answers[field] : undefined),
    publicRow: (row) => ({ id: str(row.id), code: str(row.code) }),
  },

  // Trace one or more named variables down the lines of code.
  'variable-trace': {
    fields: (part) => (Array.isArray(part.columns) ? part.columns : []),
    expected: (row, field) => (row.answers ? row.answers[field] : undefined),
    publicRow: (row) => ({ id: str(row.id), code: str(row.code) }),
  },

  // Student writes a line (or small block) of Python.
  // FUTURE: an execution-based checker (run the line in Pyodide and
  // compare behavior) could replace the exact string match for this type.
  // It would slot into validator.isCorrect's caller, not here.
  'free-form': {
    fields: () => ['answer'],
    expected: (row) => row.answer,
    publicRow: (row) => ({
      id: str(row.id),
      prompt: str(row.prompt),
      starter: str(row.starter),
    }),
  },

  // One character per row; student supplies the shifted character.
  'caesar-cipher': {
    fields: () => ['answer'],
    expected: (row) => row.answer,
    publicRow: (row) => ({ id: str(row.id), char: str(row.char) }),
  },
};

/* ---- Reading + grouping ------------------------------------------------- */

// Read and JSON-parse every *.json file in /problem-sets. A malformed or
// unreadable file is skipped and logged, so one typo cannot take the whole
// page down. Returns an array of raw "part" objects (one per file).
function readPartFiles() {
  let names;
  try {
    names = fs
      .readdirSync(SETS_DIR)
      .filter((n) => n.toLowerCase().endsWith('.json'))
      .filter((n) => n.toLowerCase() !== 'template.schema.json');
  } catch (err) {
    console.error(`Could not read problem-sets folder: ${err.message}`);
    return [];
  }

  const parts = [];
  for (const name of names) {
    try {
      const raw = fs.readFileSync(path.join(SETS_DIR, name), 'utf8');
      const obj = JSON.parse(raw);
      obj._file = name; // kept server-side only for clearer error messages
      if (isValidPart(obj, name)) parts.push(obj);
    } catch (err) {
      console.error(`Skipping problem-set file "${name}": ${err.message}`);
    }
  }
  return parts;
}

// Minimal validation: enough to keep a broken file from crashing a page.
// Logs the reason so an author can fix the file.
function isValidPart(obj, name) {
  if (!obj || typeof obj !== 'object') {
    console.error(`Skipping "${name}": not a JSON object.`);
    return false;
  }
  if (!obj.setId) {
    console.error(`Skipping "${name}": missing "setId".`);
    return false;
  }
  if (!obj.id) {
    console.error(`Skipping "${name}": missing part "id".`);
    return false;
  }
  if (!TYPES[obj.type]) {
    console.error(`Skipping "${name}": unknown type "${obj.type}".`);
    return false;
  }
  if (!Array.isArray(obj.rows)) {
    console.error(`Skipping "${name}": "rows" must be an array.`);
    return false;
  }
  return true;
}

// Group the flat list of parts into sets keyed by setId, sorted for the rail.
// Each set: { setId, title, order, demo, parts:[...] } with parts sorted by
// partOrder. Returns an array of sets.
function groupIntoSets(parts) {
  const bySet = new Map();

  for (const part of parts) {
    if (!bySet.has(part.setId)) {
      bySet.set(part.setId, {
        setId: part.setId,
        title: '',
        order: null,
        demo: false,
        parts: [],
      });
    }
    const set = bySet.get(part.setId);
    // Set-level fields can live on any part file; take the first non-empty.
    if (!set.title && part.setTitle) set.title = String(part.setTitle);
    if (set.order === null && typeof part.order === 'number') set.order = part.order;
    if (part.demo) set.demo = true;
    set.parts.push(part);
  }

  const sets = [];
  for (const set of bySet.values()) {
    set.parts.sort(byPartOrder);
    if (!set.title) set.title = set.setId; // fall back to the id
    sets.push(set);
  }

  // Numbered sets first (by order), then demos, then anything left.
  sets.sort((a, b) => {
    if (a.demo !== b.demo) return a.demo ? 1 : -1;
    const ao = a.order === null ? Infinity : a.order;
    const bo = b.order === null ? Infinity : b.order;
    return ao - bo;
  });
  return sets;
}

function byPartOrder(a, b) {
  const ao = typeof a.partOrder === 'number' ? a.partOrder : 0;
  const bo = typeof b.partOrder === 'number' ? b.partOrder : 0;
  if (ao !== bo) return ao - bo;
  return String(a.id).localeCompare(String(b.id));
}

// How many points a part is worth: one point per gradable field per row.
// (predict-output: 1/row; valid-invalid-type: 2/row; variable-trace:
// one per traced column; etc.) Authors never hand-count points.
function partPoints(part) {
  const fieldCount = TYPES[part.type].fields(part).length;
  return part.rows.length * fieldCount;
}

function setPoints(set) {
  return set.parts.reduce((sum, p) => sum + partPoints(p), 0);
}

/* ---- Public shapes (what the browser is allowed to receive) ------------- */

// The list for the rail: ids, titles, ordering, point totals. No rows,
// no answers.
function listSets() {
  return groupIntoSets(readPartFiles()).map((set) => ({
    setId: set.setId,
    title: set.title,
    order: set.order,
    demo: set.demo,
    pointsPossible: setPoints(set),
    partCount: set.parts.length,
  }));
}

// The full public shape of ONE set: metadata plus every part rendered
// answer-free. This is exactly what GET /api/sets/:setId returns and what
// the front end renders from. Returns null if the set id is unknown.
function getPublicSet(setId) {
  const set = groupIntoSets(readPartFiles()).find((s) => s.setId === setId);
  if (!set) return null;

  return {
    setId: set.setId,
    title: set.title,
    order: set.order,
    demo: set.demo,
    pointsPossible: setPoints(set),
    parts: set.parts.map(toPublicPart),
  };
}

// Build one part's public shape by copying ONLY known-safe fields. Answers
// are never read here, so they cannot leak. Type-specific display data
// (variable-trace columns, caesar shift/direction) is copied through because
// the student needs it to answer; it is not an answer itself.
function toPublicPart(part) {
  const type = TYPES[part.type];
  const out = {
    id: str(part.id),
    part: str(part.part),
    type: part.type,
    instructions: normalizeInstructions(part.instructions),
    pointsPossible: partPoints(part),
    rows: part.rows.map(type.publicRow),
  };

  if (part.type === 'variable-trace') {
    out.columns = Array.isArray(part.columns) ? part.columns.map(String) : [];
  }
  if (part.type === 'caesar-cipher') {
    out.shift = Number(part.shift) || 0;
    out.direction = part.direction === 'decrypt' ? 'decrypt' : 'encrypt';
  }
  return out;
}

// Instructions may be a single string or an array of lines. Always hand the
// client an array of strings so it can render each line as plain text.
function normalizeInstructions(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value.length) return [value];
  return [];
}

/* ---- Answer checking (server only) -------------------------------------- */

// Look up the correct answer for one field of one row. This is the only
// function that reads answer values, and it runs only on the server inside
// the /check route. Returns { found:false } when the set/part/row/field is
// unknown (so the route can answer cleanly without trusting client input).
function getExpected(setId, partId, rowId, field) {
  const part = groupIntoSets(readPartFiles())
    .find((s) => s.setId === setId)
    ?.parts.find((p) => String(p.id) === String(partId));
  if (!part) return { found: false };

  const validFields = TYPES[part.type].fields(part).map(String);
  if (!validFields.includes(String(field))) return { found: false };

  const row = part.rows.find((r) => String(r.id) === String(rowId));
  if (!row) return { found: false };

  const expected = TYPES[part.type].expected(row, field);
  if (expected === undefined) return { found: false };

  // An optional, author-written hint shown only when the answer is wrong.
  // It lives in the file (not the public shape), so students never see it
  // until they actually miss the row.
  return { found: true, expected, hint: typeof row.hint === 'string' ? row.hint : null };
}

// Read every part once at startup and log a one-line summary, so an author
// sees immediately if a file failed to load. Does not throw.
function warmup() {
  const sets = groupIntoSets(readPartFiles());
  const parts = sets.reduce((n, s) => n + s.parts.length, 0);
  console.log(`Problem sets loaded: ${sets.length} set(s), ${parts} part file(s).`);
}

module.exports = { listSets, getPublicSet, getExpected, warmup, TYPES };
