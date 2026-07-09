/* =========================================================
   Python Playground — Interactive environment
   (loaded on programming-playground.html only)

   VS Code-style three-column layout, all client side:
     1. Assignment rail (left)  — pick between assignments
     2. Code editor     (center)— CodeMirror 6 + output (the coding window)
     3. Assignment panel(right) — instructions + a "Test Code" tester

   Assignments are NOT hardcoded here: they are authored as JSON files in
   /public/assignments and fetched at load time from GET /api/assignments
   (see server.js and that folder's README.md). Adding an assignment is just
   dropping a new JSON file in that folder.

   This file loads as an ES module, so it defers by default, matching the way
   the shared /js/main.js is added with `defer`. CodeMirror 6 is resolved from
   a CDN through the import map in programming-playground.html; Pyodide is
   injected from its CDN on demand.

   The code is organized so later features can be added without
   rearchitecting. Search for "FUTURE:" markers for the planned, but
   intentionally out-of-scope, extension points:
     - infinite-loop protection via a Web Worker + timeout
       (Pyodide runs on the main thread for now)
     - URL save / restore of the editor contents
     - keystroke recording
   ========================================================= */

// We import from the individual CodeMirror packages, NOT the "codemirror"
// meta-package. That meta-package is pure re-exports; once its
// dependencies are marked "external" in the import map, esm.sh builds it
// empty (no EditorView, no basicSetup). The packages below contain real
// code, so they survive externalization and resolve to single shared
// copies through the import map.
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
} from "@codemirror/view";
import { Compartment } from "@codemirror/state";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  indentOnInput,
} from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";

// A compact stand-in for the meta-package's "basicSetup", assembled from
// the individual packages above. Gives us a line-number gutter, history
// (undo/redo), bracket matching/closing, auto-indent, and sensible
// editing keymaps. syntaxHighlighting + defaultHighlightStyle colors the
// Python tokens in light mode (One Dark brings its own colors in dark).
const editorBasics = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightActiveLine(),
  drawSelection(),
  dropCursor(),
  history(),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...historyKeymap,
    indentWithTab, // Tab indents inside the editor
  ]),
];

/* ---- Configuration ------------------------------------- */

// Pinned Pyodide build. Bump the version here to upgrade.
const PYODIDE_VERSION = "v0.26.4";
const PYODIDE_INDEX_URL =
  "https://cdn.jsdelivr.net/pyodide/" + PYODIDE_VERSION + "/full/";

/* ---- Assignments (loaded from /api/assignments) -------- */
/*
   Each assignment drives a rail entry, the right-hand panel, and the tester.
   Tests are declarative data (no functions), so they can live in JSON:

     - type "source": tested against the editor TEXT (does not run the
       program). Uses a regex `pattern` (+ optional `flags`) or a `contains`
       substring; optional `negate` flips the result.
     - type "output": runs the program with `input` fed to input() in order,
       captures stdout/stderr, and requires an EXACT match against the
       expected output (character-for-character, including the newline that
       print() adds). input() writes its prompt to stdout with no trailing
       newline, which the expected string must reflect. Optional
       `ignorePromptSpace: true` relaxes one thing: a question mark followed
       by spaces compares equal to a bare question mark, so a student's
       input("...name? ") passes a test authored as "...name?".

   instructions HTML comes from the JSON a teacher authored, so it is trusted
   and assigned with innerHTML. Student code is never placed into innerHTML —
   only into textContent — so there is no injection surface.
*/
let assignments = [];

function assignmentById(id) {
  return assignments.find((a) => a.id === id) || assignments[0];
}

// Fetch + normalize the assignment files.
async function loadAssignments() {
  const res = await fetch("/api/assignments");
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  const list = Array.isArray(data) ? data : data.assignments || [];
  return list.map(normalizeAssignment);
}

// Arrays for `starter`/`instructions` are joined into one string so multi-line
// content reads nicely in the JSON source.
function normalizeAssignment(raw) {
  return {
    id: String(raw.id),
    name: raw.name || String(raw.id),
    blurb: raw.blurb || "",
    starter: joinLines(raw.starter),
    instructionsHTML: joinLines(raw.instructions),
    tests: Array.isArray(raw.tests) ? raw.tests.map(normalizeTest) : [],
  };
}

function normalizeTest(t) {
  return {
    name: t.name || "Test",
    type: t.type === "output" ? "output" : "source",
    pattern: typeof t.pattern === "string" ? t.pattern : null,
    flags: typeof t.flags === "string" ? t.flags : "",
    contains: typeof t.contains === "string" ? t.contains : null,
    negate: !!t.negate,
    input: Array.isArray(t.input) ? t.input : [],
    expected: buildExpected(t.expected),
    ignorePromptSpace: !!t.ignorePromptSpace,
  };
}

// `expected` as a string is used verbatim; as an array it is treated as one
// printed line each (joined with newlines + a trailing newline, matching the
// common "one print() per line" case).
function buildExpected(v) {
  if (Array.isArray(v)) return v.length ? v.join("\n") + "\n" : "";
  return typeof v === "string" ? v : "";
}

function joinLines(v) {
  if (Array.isArray(v)) return v.join("\n");
  return typeof v === "string" ? v : "";
}

// Compare captured output to an output test's expected string. With
// `ignorePromptSpace` set, "? " (question mark + spaces) and "?" compare
// equal on both sides, so it doesn't matter whether the student put a space
// inside their input() prompt after the question mark.
function outputMatches(got, test) {
  if (!test.ignorePromptSpace) return got === test.expected;
  const collapse = (s) => s.replace(/\? +/g, "?");
  return collapse(got) === collapse(test.expected);
}

// Evaluate a declarative "source" test against the code text.
function sourceTestPasses(test, src) {
  let hit = false;
  if (test.pattern) {
    try {
      hit = new RegExp(test.pattern, test.flags).test(src);
    } catch (e) {
      hit = false; // a malformed pattern fails safe rather than throwing
    }
  } else if (test.contains) {
    hit = src.includes(test.contains);
  }
  return test.negate ? !hit : hit;
}

/* ---- Element lookups ----------------------------------- */

const editorMount = document.getElementById("pyenv-editor");
const outputEl = document.getElementById("pyenv-output");
const runButton = document.getElementById("pyenv-run");
const statusEl = document.getElementById("pyenv-status");
const railEl = document.getElementById("pyenv-rail");
const panelEl = document.getElementById("pyenv-panel");

/* ---- Editor theming ------------------------------------ */

// A Compartment lets us swap the editor theme at runtime when the site
// theme toggles, without rebuilding the whole editor.
const themeCompartment = new Compartment();

// Minimal base theme: inherit the site's monospace font and let the
// editor fill its pane (which styles.css frames with theme tokens).
const baseTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "0.95rem" },
  ".cm-scroller": { fontFamily: "var(--font-mono)" },
});

// Map the current site theme onto a CodeMirror theme.
//   dark  -> One Dark (a VS Code-like dark scheme)
//   light -> CodeMirror's default light styling (matches our white surface)
function currentSiteTheme() {
  return document.documentElement.getAttribute("data-theme") || "dark";
}

function editorThemeFor(siteTheme) {
  return siteTheme === "dark" ? oneDark : [];
}

/* ---- Runtime state ------------------------------------- */

// Lazy Pyodide singleton. We keep the loading promise so repeated calls
// await the same initialization rather than loading twice.
let pyodideReady = null;

// Flipped true once Pyodide has finished loading. Used to enable the Run
// and Test Code buttons (output tests can't run before Python is ready).
let pyodideLoaded = false;

// Guard against overlapping work (Run vs Test, double clicks mid-run).
let isBusy = false;

// Developer Data (easter egg) bookkeeping — see registerDevDataStats().
let devRunCount = 0; // Run-button presses this page load
let pythonVersionText = "loading…"; // filled in once Pyodide is up

// Which assignment is selected, plus a per-assignment cache of editor
// contents so switching back restores the student's work for the session.
let activeId = null;
const editorDocs = Object.create(null);

// Filled in by the panel renderer so the tester can find its widgets.
let testButton = null;
let testListEl = null;
let testStatusEl = null;

/* ---- 1. Code editor (CodeMirror 6) --------------------- */

function createEditor() {
  return new EditorView({
    doc: assignmentById(activeId).starter,
    parent: editorMount,
    extensions: [
      editorBasics, // gutter, history, bracket matching, editing keymaps
      python(), // Python syntax highlighting
      themeCompartment.of(editorThemeFor(currentSiteTheme())),
      baseTheme,
    ],
  });
}

// Single source of truth for the current program text. A future
// save/restore layer should read code through here too.
function getCode(editor) {
  return editor.state.doc.toString();
}

// Replace the entire document (used when switching assignments).
function setCode(editor, text) {
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: text },
  });
}

/* ---- Theme synchronization ----------------------------- */

// The shared theme toggle (in main.js) flips data-theme on <html> and
// persists it; it emits no event. We do not modify that code. Instead
// we observe the attribute and reconfigure the editor theme to match.
function wireThemeSync(editor) {
  const observer = new MutationObserver(function () {
    editor.dispatch({
      effects: themeCompartment.reconfigure(
        editorThemeFor(currentSiteTheme())
      ),
    });
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}

/* ---- 2. Python runtime (Pyodide) ----------------------- */

// Start loading Python in the background so it is ready by the time a
// student presses Run. The button stays disabled until then.
function preloadPyodide() {
  setStatus("Loading Python...");
  ensurePyodide()
    .then(function (pyodide) {
      // Version string for the Developer Data panel, e.g. "3.12.1 · Pyodide 0.26.2".
      try {
        pythonVersionText =
          pyodide.runPython('__import__("sys").version.split()[0]') +
          " · Pyodide " + pyodide.version;
      } catch (e) {
        pythonVersionText = "Pyodide " + (pyodide.version || "?");
      }
      pyodideLoaded = true;
      runButton.disabled = false;
      runButton.textContent = "Run";
      if (testButton) {
        testButton.disabled = false;
        setTestStatus("Click Test Code to check your work.");
      }
      setStatus("Ready");
    })
    .catch(function (err) {
      setStatus("Python failed to load. Please refresh the page.");
      showError("Could not start Python.\n" + String(err));
    });
}

function ensurePyodide() {
  if (pyodideReady) return pyodideReady;
  pyodideReady = loadScript(PYODIDE_INDEX_URL + "pyodide.js").then(function () {
    // window.loadPyodide is defined by the script we just loaded.
    return window.loadPyodide({ indexURL: PYODIDE_INDEX_URL });
  });
  return pyodideReady;
}

// Inject a classic script and resolve when it has loaded. Doing this in
// JS (rather than a tag in the HTML) avoids script-order coupling and
// keeps the page shell untouched.
function loadScript(src) {
  return new Promise(function (resolve, reject) {
    const el = document.createElement("script");
    el.src = src;
    el.onload = function () {
      resolve();
    };
    el.onerror = function () {
      reject(new Error("Failed to load " + src));
    };
    document.head.appendChild(el);
  });
}

/* ---- 3. Run pipeline (interactive) --------------------- */

function wireRunButton(editor) {
  runButton.addEventListener("click", function () {
    runCode(editor);
  });
}

async function runCode(editor) {
  if (isBusy) return; // ignore clicks while a run/test is in progress
  isBusy = true;
  devRunCount++;

  runButton.disabled = true;
  runButton.textContent = "Running...";
  if (testButton) testButton.disabled = true;
  clearOutput();

  // Result shape kept stable for callers/future hooks to consume.
  const result = { ok: true, error: null };

  try {
    const pyodide = await ensurePyodide();
    const source = getCode(editor);

    // Guardrail: activities never need imports, so reject any import
    // statement before running. The check parses with Python's ast, so the
    // word "import" inside a string — e.g. print("this is important") — or an
    // identifier is not an Import node and runs normally.
    if (hasImportStatement(pyodide, source)) {
      showError("No imports are allowed in the Python Programming Playground.");
      result.ok = false;
      return result;
    }

    // Route both streams into the output pane. We use `write` (raw bytes)
    // rather than `batched` because `batched` strips the trailing newline
    // from each chunk, which would collapse separate print() lines onto one
    // line. Decoding the bytes ourselves preserves newlines exactly (and
    // handles print(..., end="") correctly too).
    pyodide.setStdout({ write: writeOutputBytes });
    pyodide.setStderr({ write: writeOutputBytes });

    // Wire up stdin so input() works. The browser has no terminal, so we
    // collect each line through a prompt dialog. See readStdinLine.
    pyodide.setStdin({ stdin: readStdinLine });

    await pyodide.runPythonAsync(source);
  } catch (err) {
    // Pyodide raises a PythonError whose message holds the traceback.
    result.ok = false;
    result.error = err;
    showError(formatError(err));
  } finally {
    if (result.ok && outputEl.textContent === "") {
      appendOutput("Program finished with no output.\n");
    }
    isBusy = false;
    runButton.disabled = false;
    runButton.textContent = "Run";
    if (testButton) testButton.disabled = false;
    setStatus(result.ok ? "Finished" : "Finished with an error");
  }

  return result;
}

// True if the source contains a real import. We parse with Python's own ast
// in a throwaway namespace, which gives two things: (a) "import" inside a
// string or a word like "important" is not an import node, so it is ignored;
// and (b) the check runs isolated from the student's globals, so
// previously-run code can't tamper with it. A syntax error counts as "no
// import" so the normal run path reports the SyntaxError as usual.
//
// Flagged: `import ...` / `from ... import ...` statements, plus any
// reference to the __import__ builtin (e.g. __import__("os") or
// builtins.__import__), which would otherwise load a module without an
// import statement.
function hasImportStatement(pyodide, source) {
  const ns = pyodide.toPy({ _src: source });
  try {
    return pyodide.runPython(
      `
import ast

def _pp_is_import(n):
    if isinstance(n, (ast.Import, ast.ImportFrom)):
        return True
    if isinstance(n, ast.Name) and n.id == "__import__":
        return True
    if isinstance(n, ast.Attribute) and n.attr == "__import__":
        return True
    return False

try:
    _flag = any(_pp_is_import(n) for n in ast.walk(ast.parse(_src)))
except SyntaxError:
    _flag = False
_flag
`,
      { globals: ns }
    );
  } finally {
    ns.destroy();
  }
}

/* ---- 4. Tester ----------------------------------------- */

// Run `source` once with a fixed list of input lines, capturing stdout and
// stderr into a single string. Used only by the tester, so it does NOT pop
// up the prompt dialog the interactive runner uses; instead canned input is
// fed line-by-line and is not echoed (the program's own prints, including
// any input() prompt, are the only thing captured). A fresh globals dict
// isolates each test from the others.
async function runForCapture(pyodide, source, inputLines) {
  const decoder = new TextDecoder();
  let captured = "";
  const sink = function (bytes) {
    captured += decoder.decode(bytes, { stream: true });
    return bytes.length;
  };

  let i = 0;
  const cannedStdin = function () {
    if (i >= inputLines.length) return null; // EOF -> EOFError in Python
    const line = String(inputLines[i++]).slice(0, MAX_STDIN_LINE);
    return line + "\n";
  };

  pyodide.setStdout({ write: sink });
  pyodide.setStderr({ write: sink });
  pyodide.setStdin({ stdin: cannedStdin });

  const globals = pyodide.toPy({});
  try {
    await pyodide.runPythonAsync(source, { globals });
    return { ok: true, output: captured, error: null };
  } catch (err) {
    return { ok: false, output: captured, error: err };
  } finally {
    globals.destroy();
  }
}

function wireTestButton(editor) {
  // The button is (re)created with each panel render, so we delegate from
  // the panel container instead of binding to a specific node.
  panelEl.addEventListener("click", function (event) {
    const btn = event.target.closest(".pyenv__test-btn");
    if (btn) runTests(editor);
  });
}

async function runTests(editor) {
  if (isBusy) return;
  const assignment = assignmentById(activeId);
  if (!assignment.tests.length) return;

  isBusy = true;
  runButton.disabled = true;
  if (testButton) {
    testButton.disabled = true;
    testButton.textContent = "Testing...";
  }
  setTestStatus("Running tests...");

  const source = getCode(editor);
  let passed = 0;

  try {
    const pyodide = await ensurePyodide();
    const importsBlocked = hasImportStatement(pyodide, source);

    // Render rows up front as "pending", then fill each in as it resolves.
    renderTestRows(assignment.tests);

    for (let idx = 0; idx < assignment.tests.length; idx++) {
      const test = assignment.tests[idx];
      let pass = false;
      let detail = null;

      if (importsBlocked) {
        pass = false;
        detail = {
          text: "Imports are not allowed here — remove the import to run the tests.",
        };
      } else if (test.type === "source") {
        pass = sourceTestPasses(test, source);
        if (!pass) detail = { text: "Your code doesn't include this yet." };
      } else {
        // output test
        const res = await runForCapture(pyodide, source, test.input || []);
        if (!res.ok) {
          pass = false;
          detail = { text: "Your program raised an error:", got: res.output + formatError(res.error) };
        } else {
          pass = outputMatches(res.output, test);
          if (!pass) {
            detail = { text: "Output didn't match exactly.", expected: test.expected, got: res.output };
          }
        }
      }

      if (pass) passed++;
      updateTestRow(idx, pass, detail);
    }
  } finally {
    isBusy = false;
    runButton.disabled = false;
    if (testButton) {
      testButton.disabled = false;
      testButton.textContent = "Test Code";
    }
    const total = assignment.tests.length;
    setTestStatus(
      passed === total
        ? "All " + total + " tests passed. 🎉"
        : passed + " of " + total + " tests passed."
    );
  }
}

/* ---- 5. Rail + panel rendering ------------------------- */

function renderRail() {
  railEl.innerHTML = "";

  const title = document.createElement("h2");
  title.className = "pyenv__rail-title";
  title.textContent = "Assignments";
  railEl.appendChild(title);

  const list = document.createElement("ul");
  list.className = "pyenv__pick-list";

  assignments.forEach(function (a, i) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pyenv__pick" + (a.id === activeId ? " is-active" : "");
    btn.dataset.id = a.id;
    if (a.id === activeId) btn.setAttribute("aria-current", "true");

    const name = document.createElement("span");
    name.className = "pyenv__pick-name";
    // Number comes from the file order, so authors don't manage numbering.
    name.textContent = i + 1 + " · " + a.name;
    const blurb = document.createElement("span");
    blurb.className = "pyenv__pick-blurb";
    blurb.textContent = a.blurb;

    btn.appendChild(name);
    btn.appendChild(blurb);
    li.appendChild(btn);
    list.appendChild(li);
  });

  railEl.appendChild(list);
}

function renderPanel() {
  const assignment = assignmentById(activeId);
  panelEl.innerHTML = "";
  testButton = testListEl = testStatusEl = null;

  const heading = document.createElement("h2");
  heading.className = "pyenv__heading";
  heading.textContent = assignment.name;
  panelEl.appendChild(heading);

  const prose = document.createElement("div");
  prose.className = "pyenv__prose";
  prose.innerHTML = assignment.instructionsHTML; // trusted, authored in JSON
  panelEl.appendChild(prose);

  if (!assignment.tests.length) return; // open playground: no tester

  const tests = document.createElement("div");
  tests.className = "pyenv__tests";

  testButton = document.createElement("button");
  testButton.type = "button";
  testButton.className = "pyenv__test-btn";
  testButton.textContent = "Test Code";
  // Disabled until Pyodide is ready (output tests need it).
  testButton.disabled = !pyodideLoaded;
  tests.appendChild(testButton);

  testStatusEl = document.createElement("span");
  testStatusEl.className = "pyenv__test-status";
  testStatusEl.setAttribute("role", "status");
  testStatusEl.setAttribute("aria-live", "polite");
  testStatusEl.textContent = pyodideLoaded
    ? "Click Test Code to check your work."
    : "Python is loading — Test Code will enable in a moment.";
  tests.appendChild(testStatusEl);

  testListEl = document.createElement("ul");
  testListEl.className = "pyenv__test-list";
  tests.appendChild(testListEl);

  panelEl.appendChild(tests);

  // Show the test names in their starting (un-run) state.
  renderTestRows(assignment.tests);
}

// (Re)draw all test rows in the pending state (icon "•", no detail).
function renderTestRows(tests) {
  if (!testListEl) return;
  testListEl.innerHTML = "";
  tests.forEach(function (test) {
    const li = document.createElement("li");
    li.className = "pyenv__test";

    const icon = document.createElement("span");
    icon.className = "pyenv__test-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "•";

    const name = document.createElement("span");
    name.className = "pyenv__test-name";
    // Screen-reader-only result prefix ("Passed:"/"Failed:") — the ✓/✗ icon
    // is aria-hidden, so this span is what announces the state.
    const srResult = document.createElement("span");
    srResult.className = "visually-hidden pyenv__test-sr";
    name.appendChild(srResult);
    name.appendChild(document.createTextNode(test.name));

    li.appendChild(icon);
    li.appendChild(name);
    testListEl.appendChild(li);
  });
}

// Update one row to pass/fail and (optionally) render a detail block.
function updateTestRow(index, pass, detail) {
  if (!testListEl) return;
  const li = testListEl.children[index];
  if (!li) return;

  li.classList.remove("pyenv__test--pass", "pyenv__test--fail");
  li.classList.add(pass ? "pyenv__test--pass" : "pyenv__test--fail");

  const icon = li.querySelector(".pyenv__test-icon");
  if (icon) icon.textContent = pass ? "✓" : "✗";

  const sr = li.querySelector(".pyenv__test-sr");
  if (sr) sr.textContent = pass ? "Passed: " : "Failed: ";

  // Clear any prior detail.
  const old = li.querySelector(".pyenv__test-detail");
  if (old) old.remove();

  if (!pass && detail) {
    const wrap = document.createElement("div");
    wrap.className = "pyenv__test-detail";

    const text = document.createElement("p");
    text.style.margin = "0";
    text.textContent = detail.text || "";
    wrap.appendChild(text);

    if (typeof detail.expected === "string") {
      const exp = document.createElement("pre");
      exp.className = "is-expected";
      exp.textContent = visibleWhitespace(detail.expected);
      wrap.appendChild(labeled("Expected", exp));
    }
    if (typeof detail.got === "string") {
      const got = document.createElement("pre");
      got.textContent = visibleWhitespace(detail.got);
      wrap.appendChild(labeled("Your output", got));
    }

    li.appendChild(wrap);
  }
}

// Wrap a <pre> with a small caption, returning a fragment.
function labeled(label, pre) {
  const frag = document.createDocumentFragment();
  const cap = document.createElement("span");
  cap.textContent = label + ":";
  frag.appendChild(cap);
  frag.appendChild(pre);
  return frag;
}

// Make newlines visible in the expected/actual blocks so an "exact match"
// failure caused only by a missing/extra newline is legible.
function visibleWhitespace(text) {
  return text.replace(/\n/g, "⏎\n");
}

/* ---- Assignment switching ------------------------------ */

function wireRailSelection(editor) {
  railEl.addEventListener("click", function (event) {
    const btn = event.target.closest(".pyenv__pick");
    if (!btn) return;
    selectAssignment(editor, btn.dataset.id);
  });
}

function selectAssignment(editor, id) {
  if (id === activeId || isBusy) return;

  // Preserve the current assignment's work before switching away.
  editorDocs[activeId] = getCode(editor);

  activeId = id;
  const next = id in editorDocs ? editorDocs[id] : assignmentById(id).starter;
  setCode(editor, next);

  clearOutput();
  setStatus("Ready");

  // renderRail() rebuilds the picker, destroying the button that was just
  // activated. If focus was inside the rail (keyboard user), move it to the
  // freshly rendered active button so tabbing doesn't restart from <body>.
  const hadRailFocus = railEl.contains(document.activeElement);
  renderRail();
  renderPanel();
  if (hadRailFocus) {
    const activeBtn = railEl.querySelector(".pyenv__pick.is-active");
    if (activeBtn) activeBtn.focus();
  }
}

/* ---- Output helpers ------------------------------------ */

function clearOutput() {
  outputEl.textContent = "";
  pendingPromptLine = "";
}

// Provide stdin for input(). Python's input(prompt) first writes `prompt`
// to stdout, which we've captured as the current un-terminated output line
// (pendingPromptLine); we reuse it as the dialog label so the student sees
// the same question in the popup. Returning the line plus "\n" terminates
// one read; returning null signals EOF (e.g. the student presses Cancel),
// which surfaces in Python as EOFError.
const MAX_STDIN_LINE = 2048; // cap one input() line so a huge paste can't bog down the tab
function readStdinLine() {
  const reply = window.prompt(pendingPromptLine || "Program input:");
  if (reply === null) return null;
  const line = reply.slice(0, MAX_STDIN_LINE);
  appendOutput(line + "\n"); // echo the answer into the visible transcript
  return line + "\n";
}

// Decode raw stdout/stderr bytes from Pyodide and append them verbatim,
// preserving newlines. Pyodide's `write` callback must return the number
// of bytes consumed. A streaming TextDecoder keeps multi-byte characters
// intact if they ever straddle a chunk boundary.
const outputDecoder = new TextDecoder();
function writeOutputBytes(buffer) {
  appendOutput(outputDecoder.decode(buffer, { stream: true }));
  return buffer.length;
}

// The current output line that has not yet ended in a newline. input()
// writes its prompt here (no trailing newline), so readStdinLine can reuse
// it as the prompt dialog's label.
let pendingPromptLine = "";

// Append plain program output and keep the latest line in view.
function appendOutput(text) {
  outputEl.appendChild(document.createTextNode(text));
  outputEl.scrollTop = outputEl.scrollHeight;

  // Track the text after the last newline as the pending (unterminated) line.
  const lastNewline = text.lastIndexOf("\n");
  pendingPromptLine =
    lastNewline === -1 ? pendingPromptLine + text : text.slice(lastNewline + 1);
}

// Render an error block. It is flagged with the theme accent (not a new
// red) so it follows light/dark mode and respects the "theme tokens
// only, no new palette" rule. See .pyenv__output-line--error in CSS.
function showError(message) {
  const block = document.createElement("span");
  block.className = "pyenv__output-line--error";
  block.textContent = message;
  outputEl.appendChild(block);
  outputEl.scrollTop = outputEl.scrollHeight;
}

// Pyodide's message already reads as a Python traceback, which is the
// most useful thing for a beginner to see. Just trim trailing space.
function formatError(err) {
  const text = err && err.message ? err.message : String(err);
  return text.replace(/\s+$/, "");
}

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function setTestStatus(text) {
  if (testStatusEl) testStatusEl.textContent = text;
}

/* ---- Developer Data (easter egg) ------------------------ */

// The panel itself is shared site-wide (/js/devdata.js, loaded before
// this module). Here we just prepend the playground-only stats that
// need the editor and the Python runtime.
function registerDevDataStats(editor) {
  if (!window.devdata) return;
  window.devdata.addStats([
    { label: "Lines of code", value: function () { return getCode(editor).split("\n").length.toLocaleString(); } },
    { label: "Characters of code", value: function () { return getCode(editor).length.toLocaleString(); } },
    { label: "Runs this session", value: function () { return devRunCount.toLocaleString(); } },
    { label: "Python", value: function () { return pythonVersionText; } },
  ]);
}

/* ---- Boot ---------------------------------------------- */

// Show a brief placeholder in the rail while the assignment files load.
function showLoadingState() {
  railEl.innerHTML = "";
  const p = document.createElement("p");
  p.className = "pyenv__note";
  p.style.padding = "0.85rem";
  p.textContent = "Loading assignments…";
  railEl.appendChild(p);
}

// Surface a load failure in the panel rather than leaving a blank page.
function showLoadError(err) {
  panelEl.innerHTML = "";
  const h = document.createElement("h2");
  h.className = "pyenv__heading";
  h.textContent = "Couldn't load assignments";
  const p = document.createElement("p");
  p.className = "pyenv__prose";
  p.textContent =
    "Please refresh the page. (" +
    (err && err.message ? err.message : String(err)) +
    ")";
  panelEl.appendChild(h);
  panelEl.appendChild(p);
  console.error("Failed to load assignments:", err);
}

// Initialize only when the playground markup is present. Assignments are
// fetched first (Python loads in parallel), then the editor/rail/panel are
// built around the first assignment.
async function initPlayground() {
  preloadPyodide(); // start Python loading immediately, in the background
  showLoadingState();

  try {
    assignments = await loadAssignments();
  } catch (err) {
    showLoadError(err);
    return;
  }
  if (!assignments.length) {
    showLoadError(new Error("No assignment files found."));
    return;
  }

  activeId = assignments[0].id;
  editorDocs[activeId] = assignmentById(activeId).starter;

  const editor = createEditor();
  renderRail();
  renderPanel();
  wireThemeSync(editor);
  wireRunButton(editor);
  wireRailSelection(editor);
  wireTestButton(editor);
  registerDevDataStats(editor);
}

if (editorMount && outputEl && runButton && railEl && panelEl) {
  initPlayground();
}
