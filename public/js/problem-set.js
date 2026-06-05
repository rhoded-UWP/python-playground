/* =========================================================
   Problem Sets page behavior (problem-sets.html only)

   What this file does:
     1. Loads the list of sets from GET /api/sets and builds the left rail
        (numbered slots PS 1..20 plus a Demos group).
     2. When a set is picked, loads its answer-free "public shape" from
        GET /api/sets/:setId and renders the activity: one section per part,
        a row per question, with the right inputs for that part's type.
     3. When a student commits one answer (blur, Enter, change, or click),
        it POSTs just that one value to POST /api/sets/:setId/check and shows
        the server's correct / incorrect verdict on that row.
     4. Submit asks for a name, stamps it on the activity, saves the activity
        as a PNG (the interim "submission"), then resets to empty.

   IMPORTANT: this file never receives or stores correct answers. It only
   ever sees a per-line verdict from the server. All correct answers live in
   /problem-sets on the server. Code and prompts are placed with textContent
   only, never innerHTML, so there is no injection surface.

   Loaded as an ES module (so it defers and can use import), matching the
   programming playground.
   ========================================================= */

// DOM-to-image, used to save the finished activity as a PNG client-side.
// Pinned version so a CDN change cannot move under us.
import { toPng } from "https://esm.sh/html-to-image@1.11.13";

/* ---- Configuration ----------------------------------------------------- */

// How many numbered slots the rail shows by default. If a published set has
// a higher order number, the rail grows to include it. Bump this as the
// course grows past 20 sets.
const NUM_SLOTS = 20;

// The fixed option lists for the valid-invalid-type parts. These must match
// the answer strings authored in the JSON (exact match).
const VALIDITY_OPTIONS = ["Valid", "Invalid"];
const DATA_TYPES = ["string", "integer", "float", "boolean"];

/* ---- Element lookups + state ------------------------------------------- */

const railEl = document.getElementById("ps-rail");
const mainEl = document.getElementById("ps-main");

// The currently loaded public set (no answers). Used by Reset and Submit.
let currentSet = null;

// Live score. scoreState maps a field key ("partId|rowId|field") to whether
// that field is currently correct, so the running total updates as students
// fix answers (and drops back down if they break a correct one). scoreEarnedEl
// is the number shown in the big "earned / total" readout. Both are reset
// every time the activity is rendered.
const scoreState = new Map();
let scoreEarnedEl = null;

/* ---- Tiny DOM helper --------------------------------------------------- */

// Build an element. attrs special keys: class, text, dataset. Everything
// else becomes an attribute. children is a node or an array of nodes.
// Using text/textContent (never innerHTML) keeps student- and author-
// supplied strings inert.
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else node.setAttribute(key, value);
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const child of kids) if (child != null) node.append(child);
  return node;
}

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

/* ---- Boot -------------------------------------------------------------- */

async function init() {
  let sets;
  try {
    sets = (await fetchJSON("/api/sets")).sets || [];
  } catch (err) {
    railEl.replaceChildren(
      el("p", { class: "ps-banner", text: "Could not load problem sets. Please refresh the page." })
    );
    console.error("Failed to load /api/sets:", err);
    return;
  }

  renderRail(sets);

  // Deep link support: problem-sets.html?set=ps2 opens that set directly.
  const wanted = new URLSearchParams(location.search).get("set");
  const initial =
    sets.find((s) => s.setId === wanted) ||
    sets.find((s) => !s.demo) || // first numbered set (the list is pre-sorted)
    sets[0];

  if (initial) selectSet(initial.setId);
  else mainEl.replaceChildren(el("p", { class: "ps-note", text: "No problem sets are published yet." }));
}

/* ---- Left rail --------------------------------------------------------- */

function renderRail(sets) {
  const numbered = sets.filter((s) => !s.demo && typeof s.order === "number");
  const demos = sets.filter((s) => s.demo);
  const byOrder = new Map(numbered.map((s) => [s.order, s]));
  const maxOrder = numbered.reduce((m, s) => Math.max(m, s.order), 0);
  const slotCount = Math.max(NUM_SLOTS, maxOrder);

  const frag = document.createDocumentFragment();

  // Numbered problem sets 1..slotCount. Published slots are clickable and
  // show their title; the rest are "Not completed" placeholders.
  const group = el("div", { class: "ps-rail__group" });
  group.append(el("h2", { class: "ps-rail__title", text: "Problem Sets" }));
  const list = el("ul", { class: "ps-rail__list" });
  for (let n = 1; n <= slotCount; n++) {
    const set = byOrder.get(n);
    list.append(el("li", {}, set ? publishedSlot(set, "PS " + n) : emptySlot(n)));
  }
  group.append(list);
  frag.append(group);

  // Demo sets (Caesar, free-form, etc.) live in their own group.
  if (demos.length) {
    const dgroup = el("div", { class: "ps-rail__group" });
    dgroup.append(el("h2", { class: "ps-rail__title", text: "Demos" }));
    const dlist = el("ul", { class: "ps-rail__list" });
    demos.forEach((set) => dlist.append(el("li", {}, publishedSlot(set, "Demo"))));
    dgroup.append(dlist);
    frag.append(dgroup);
  }

  railEl.replaceChildren(frag);
}

function publishedSlot(set, prefix) {
  const btn = el("button", { type: "button", class: "ps-slot", dataset: { setId: set.setId } });
  btn.append(el("span", { class: "ps-slot__name", text: prefix + " · " + set.title }));
  btn.append(el("span", { class: "ps-slot__meta", text: pointsLabel(set) }));
  btn.addEventListener("click", () => selectSet(set.setId));
  return btn;
}

function emptySlot(n) {
  const btn = el("button", { type: "button", class: "ps-slot is-empty" });
  btn.append(el("span", { class: "ps-slot__name", text: "PS " + n }));
  btn.append(el("span", { class: "ps-slot__meta", text: "Not completed" }));
  btn.addEventListener("click", () => showPlaceholder(btn));
  return btn;
}

function pointsLabel(set) {
  const pts = set.pointsPossible + (set.pointsPossible === 1 ? " point" : " points");
  return set.partCount > 1 ? pts + " · " + set.partCount + " parts" : pts;
}

function markActive(setId) {
  railEl.querySelectorAll(".ps-slot").forEach((btn) => {
    const on = !!setId && btn.dataset.setId === setId;
    btn.classList.toggle("is-active", on);
    if (on) btn.setAttribute("aria-current", "true");
    else btn.removeAttribute("aria-current");
  });
}

function showPlaceholder(btn) {
  markActive(null);
  btn.classList.add("is-active");
  currentSet = null;
  mainEl.replaceChildren(el("p", { class: "ps-note", text: "No description available yet..." }));
  const url = new URL(location);
  url.searchParams.delete("set");
  history.replaceState(null, "", url);
}

/* ---- Load + render one set --------------------------------------------- */

async function selectSet(setId) {
  markActive(setId);
  mainEl.replaceChildren(el("p", { class: "ps-note", text: "Loading..." }));

  let set;
  try {
    set = await fetchJSON("/api/sets/" + encodeURIComponent(setId));
  } catch (err) {
    mainEl.replaceChildren(
      el("p", { class: "ps-banner", text: "Could not load that problem set. Please try again." })
    );
    console.error("Failed to load set " + setId + ":", err);
    return;
  }

  currentSet = set;
  renderActivity(set);

  // Keep the URL in sync so the set can be bookmarked or embedded.
  const url = new URL(location);
  url.searchParams.set("set", setId);
  history.replaceState(null, "", url);
}

function renderActivity(set) {
  // The capture node is what becomes the submitted PNG, so the Submit and
  // Reset buttons sit OUTSIDE it (in the toolbar) and are not in the image.
  const capture = el("div", { class: "ps-capture", id: "ps-capture" });
  const head = el("div", { class: "ps-capture__head" });
  head.append(el("h3", { class: "ps-capture__title", text: set.title }));
  const stamp = el("p", { class: "ps-capture__stamp", id: "ps-stamp" }); // filled on Submit
  head.append(stamp);
  capture.append(head);

  const parts = el("div", { class: "ps-parts" });
  set.parts.forEach((part) => parts.append(renderPart(set.setId, part)));
  capture.append(parts);

  // Start every render with a clean score (Reset and Submit reach here too).
  scoreState.clear();

  // Toolbar (title, live score, actions).
  const toolbar = el("div", { class: "ps-toolbar" });
  const meta = el("div", { class: "ps-toolbar__meta" });
  meta.append(el("h2", { class: "ps-toolbar__title", text: set.title }));
  meta.append(
    el("p", { class: "ps-toolbar__points", text: "Each line is checked as you go." })
  );

  // Big running score: earned / total. Updates on every checked answer.
  const score = el("div", { class: "ps-score", role: "status", "aria-live": "polite", "aria-label": "Score" });
  scoreEarnedEl = el("span", { class: "ps-score__earned", text: "0" });
  score.append(
    scoreEarnedEl,
    el("span", { class: "ps-score__sep", text: " / " }),
    el("span", { class: "ps-score__total", text: String(set.pointsPossible) })
  );

  const actions = el("div", { class: "ps-toolbar__actions" });
  const resetBtn = el("button", { type: "button", class: "ps-btn", text: "Reset" });
  const submitBtn = el("button", { type: "button", class: "ps-btn ps-btn--primary", text: "Submit" });
  // Reset just re-renders from the same (answer-free) set, clearing inputs,
  // verdicts, and the score back to the default empty state.
  resetBtn.addEventListener("click", () => renderActivity(set));
  submitBtn.addEventListener("click", () => submit(set, capture, submitBtn));
  actions.append(resetBtn, submitBtn);

  toolbar.append(meta, score, actions);

  mainEl.replaceChildren(toolbar, capture);
  updateScore();
}

/* ---- One part (section) ------------------------------------------------ */

function renderPart(setId, part) {
  const section = el("section", { class: "ps-part" });
  section.append(el("h3", { class: "ps-part__title", text: part.part || part.type }));

  if (Array.isArray(part.instructions) && part.instructions.length) {
    const ins = el("div", { class: "ps-part__instructions" });
    part.instructions.forEach((line) => ins.append(el("p", { text: line })));
    section.append(ins);
  }

  // Caesar parts show the shift and direction so the student knows the rule.
  if (part.type === "caesar-cipher") {
    const dir = part.direction === "decrypt" ? "decrypt (shift backward)" : "encrypt (shift forward)";
    section.append(
      el("p", { class: "ps-part__instructions", text: "Shift: " + part.shift + " · Direction: " + dir })
    );
  }

  section.append(buildTable(setId, part));
  return section;
}

// Column headers per type.
function headersFor(part) {
  switch (part.type) {
    case "predict-output":
      return ["#", "Python code", "Expected output"];
    case "valid-invalid-type":
      return ["#", "Python code", "Valid or Invalid", "Data type"];
    case "variable-trace":
      return ["#", "Python code", ...part.columns];
    case "free-form":
      return ["#", "Task", "Your Python"];
    case "caesar-cipher":
      return ["#", "Character", "Your answer"];
    default:
      return ["#", "Item", "Answer"];
  }
}

// The <td> cells for one row, per type. Each answer cell wires its own
// commit + verdict.
function cellsFor(setId, part, row) {
  const num = el("td", { class: "ps-rownum", text: String(row.id) });

  switch (part.type) {
    case "predict-output":
      return [
        num,
        el("td", {}, codeEl(row.code)),
        answerTd(textCell(setId, part.id, row.id, "answer", { label: "Row " + row.id + " expected output" })),
      ];

    case "valid-invalid-type":
      return [
        num,
        el("td", {}, codeEl(row.code)),
        answerTd(toggleCell(setId, part.id, row.id, "validity", VALIDITY_OPTIONS, "Row " + row.id + " valid or invalid")),
        answerTd(selectCell(setId, part.id, row.id, "dataType", DATA_TYPES, "Row " + row.id + " data type")),
      ];

    case "variable-trace": {
      const cells = [num, el("td", {}, codeEl(row.code))];
      part.columns.forEach((col) => {
        cells.push(answerTd(textCell(setId, part.id, row.id, col, { label: "Row " + row.id + " " + col })));
      });
      return cells;
    }

    case "free-form":
      return [
        num,
        el("td", {}, el("span", { text: row.prompt })),
        // multiline allows a small block; checked on blur so Enter can add
        // newlines. FUTURE: an execution-based checker could replace the
        // exact match here (see lib/loader.js, free-form type).
        answerTd(
          textCell(setId, part.id, row.id, "answer", {
            label: "Row " + row.id + " your Python",
            multiline: true,
            starter: row.starter,
          })
        ),
      ];

    case "caesar-cipher":
      return [
        num,
        el("td", {}, el("span", { class: "ps-char", text: row.char })),
        answerTd(textCell(setId, part.id, row.id, "answer", { label: "Row " + row.id + " shifted character", short: true })),
      ];

    default:
      return [num];
  }
}

function buildTable(setId, part) {
  const table = el("table", { class: "ps-table" });

  const thead = el("thead");
  const htr = el("tr");
  headersFor(part).forEach((h) => htr.append(el("th", { text: h })));
  thead.append(htr);
  table.append(thead);

  const tbody = el("tbody");
  part.rows.forEach((row) => {
    const tr = el("tr");
    cellsFor(setId, part, row).forEach((td) => tr.append(td));
    tbody.append(tr);
  });
  table.append(tbody);

  return table;
}

function codeEl(text) {
  return el("code", { class: "ps-code", text: String(text) });
}

// Wrap an answer control (.ps-answer) in a <td>.
function answerTd(answerNode) {
  return el("td", {}, answerNode);
}

/* ---- Answer controls (each wires its own check) ------------------------ */

// Shared scaffold: a wrapper holding the .ps-cell (control + verdict) and a
// feedback line below it.
function answerScaffold() {
  const wrapper = el("div", { class: "ps-answer" });
  const cell = el("div", { class: "ps-cell" });
  const feedback = el("p", { class: "ps-feedback" });
  const verdict = buildVerdict();
  return { wrapper, cell, feedback, verdict };
}

function buildVerdict() {
  const v = el("span", { class: "ps-verdict", role: "status", "aria-live": "polite" });
  v.append(el("span", { class: "ps-verdict__icon", "aria-hidden": "true" }));
  v.append(el("span", { class: "ps-verdict__text" }));
  return v;
}

// A text input (or textarea). Commits on blur; single-line inputs also
// commit on Enter.
function textCell(setId, partId, rowId, field, opts = {}) {
  const { wrapper, cell, feedback, verdict } = answerScaffold();
  const input = opts.multiline
    ? el("textarea", { class: "ps-input ps-input--block", rows: "2" })
    : el("input", { class: "ps-input", type: "text" });
  input.setAttribute("aria-label", opts.label || "Answer");
  if (opts.short) input.maxLength = 1;
  if (opts.starter) input.value = opts.starter;

  cell.append(input, verdict);
  wrapper.append(cell, feedback);

  const commit = () => maybeCheck(cell, feedback, setId, partId, rowId, field, input.value);
  input.addEventListener("blur", commit);
  if (!opts.multiline) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      }
    });
  }
  return wrapper;
}

// A dropdown (used for the data type). Commits on change.
function selectCell(setId, partId, rowId, field, options, label) {
  const { wrapper, cell, feedback, verdict } = answerScaffold();
  const select = el("select", { class: "ps-select", "aria-label": label });
  select.append(el("option", { value: "", text: "Choose..." }));
  options.forEach((opt) => select.append(el("option", { value: opt, text: opt })));

  cell.append(select, verdict);
  wrapper.append(cell, feedback);

  select.addEventListener("change", () =>
    maybeCheck(cell, feedback, setId, partId, rowId, field, select.value)
  );
  return wrapper;
}

// A two-button toggle (used for Valid / Invalid). Commits on click.
function toggleCell(setId, partId, rowId, field, options, label) {
  const { wrapper, cell, feedback, verdict } = answerScaffold();
  const toggle = el("div", { class: "ps-toggle", role: "group", "aria-label": label });

  options.forEach((opt) => {
    const btn = el("button", { type: "button", class: "ps-toggle__btn", "aria-pressed": "false", text: opt });
    btn.addEventListener("click", () => {
      [...toggle.children].forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      maybeCheck(cell, feedback, setId, partId, rowId, field, opt);
    });
    toggle.append(btn);
  });

  cell.append(toggle, verdict);
  wrapper.append(cell, feedback);
  return wrapper;
}

/* ---- Checking one answer ----------------------------------------------- */

// Send one answer to the server and show the verdict. Empty values are left
// neutral (not marked wrong) so a blank field is not scolded.
async function maybeCheck(cell, feedback, setId, partId, rowId, field, value) {
  // One key per gradable field, so the score counts each field once.
  const key = partId + "|" + rowId + "|" + field;

  if (value === "" || value == null) {
    clearVerdict(cell, feedback);
    scoreState.delete(key);
    updateScore();
    return;
  }

  setChecking(cell);
  try {
    const result = await fetchJSON("/api/sets/" + encodeURIComponent(setId) + "/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partId, rowId, field, value }),
    });
    setVerdict(cell, feedback, result.correct, result.feedback);
    scoreState.set(key, !!result.correct);
    updateScore();
  } catch (err) {
    clearVerdict(cell, feedback);
    scoreState.delete(key);
    updateScore();
    feedback.textContent = "Could not check that just now. Please try again.";
    console.error("Check failed:", err);
  }
}

// Recompute and show the running score: how many fields are currently correct.
function updateScore() {
  if (!scoreEarnedEl) return;
  let earned = 0;
  for (const correct of scoreState.values()) if (correct) earned += 1;
  scoreEarnedEl.textContent = String(earned);
}

function setChecking(cell) {
  cell.classList.remove("is-correct", "is-incorrect");
  cell.classList.add("is-checking");
  setIcon(cell, "…", ""); // ellipsis while waiting
}

function setVerdict(cell, feedback, correct, hint) {
  cell.classList.remove("is-checking", "is-correct", "is-incorrect");
  cell.classList.add(correct ? "is-correct" : "is-incorrect");
  if (correct) {
    setIcon(cell, "✓", "Correct"); // check mark
    feedback.textContent = "";
  } else {
    setIcon(cell, "✗", "Not yet"); // ballot x
    feedback.textContent = hint || "";
  }
}

function clearVerdict(cell, feedback) {
  cell.classList.remove("is-checking", "is-correct", "is-incorrect");
  setIcon(cell, "", "");
  feedback.textContent = "";
}

function setIcon(cell, icon, text) {
  const v = cell.querySelector(".ps-verdict");
  if (!v) return;
  v.querySelector(".ps-verdict__icon").textContent = icon;
  v.querySelector(".ps-verdict__text").textContent = text;
}

/* ---- Submit: name -> PNG -> reset -------------------------------------- */

async function submit(set, captureEl, submitBtn) {
  const name = (window.prompt("Enter your name for the submission image:") || "").trim();
  if (!name) return; // cancelled or left blank

  // Stamp the name, set title, and date onto the capture so the PNG records
  // who did it and when.
  const stamp = captureEl.querySelector("#ps-stamp");
  if (stamp) stamp.textContent = name + " · " + set.title + " · " + new Date().toLocaleDateString();

  submitBtn.disabled = true;
  submitBtn.textContent = "Rendering...";

  try {
    // Fill the transparent areas with the card's own background color so the
    // PNG is not see-through.
    const bg = getComputedStyle(captureEl).backgroundColor || "#1f1f1f";
    const dataUrl = await toPng(captureEl, { pixelRatio: 2, backgroundColor: bg });

    const link = el("a", { href: dataUrl, download: set.setId + "_" + slug(name) + ".png" });
    document.body.append(link);
    link.click();
    link.remove();
  } catch (err) {
    alert("Sorry, the image could not be created. Please try again.");
    console.error("PNG render failed:", err);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit";
    // Interim submission flow: reset to the default empty state after saving.
    renderActivity(set);
  }
}

// Make a filename-safe slug from the student's name.
function slug(name) {
  return name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "student";
}

/* ---- Start ------------------------------------------------------------- */

if (railEl && mainEl) init();
