/* =========================================================
   Python Playground — Interactive environment
   (loaded on programming-playground.html only)

   Three panes, all client side:
     1. Instructions (static text for now)
     2. Code editor  (CodeMirror 6)
     3. Output       (Pyodide stdout / stderr)

   This file loads as an ES module, so it defers by default, matching
   the way the shared /js/main.js is added with `defer`. CodeMirror 6
   is resolved from a CDN through the import map in programming-playground.html;
   Pyodide is injected from its CDN on demand.

   The code is organized so later features can be added without
   rearchitecting. Search for "FUTURE:" markers for the planned, but
   intentionally out-of-scope, extension points:
     - import blocking / source scanning
     - infinite-loop protection via a Web Worker + timeout
       (Pyodide runs on the main thread for now)
     - URL save / restore of the editor contents
     - keystroke recording
     - auto-checking of exercises (the instructions pane already has a
       hidden results slot, and runCode returns a result object)
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

// Friendly starter program shown when the page loads.
const STARTER_CODE = [
  "# Welcome to the Python Playground!",
  "# Press Run to execute this code, then try changing it.",
  "",
  'print("Welcome to the Python Playground.")',
  'print("Hello, World!")',
].join("\n");

/* ---- Element lookups ----------------------------------- */

const editorMount = document.getElementById("pyenv-editor");
const outputEl = document.getElementById("pyenv-output");
const runButton = document.getElementById("pyenv-run");
const statusEl = document.getElementById("pyenv-status");

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

// Guard against overlapping runs (e.g. double clicks mid-run).
let isRunning = false;

/* ---- 1. Code editor (CodeMirror 6) --------------------- */

function createEditor() {
  return new EditorView({
    doc: STARTER_CODE,
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
// save/restore or auto-check layer should read code through here too.
function getCode(editor) {
  return editor.state.doc.toString();
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
    .then(function () {
      runButton.disabled = false;
      runButton.textContent = "Run";
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

/* ---- 3. Run pipeline ----------------------------------- */

function wireRunButton(editor) {
  runButton.addEventListener("click", function () {
    runCode(editor);
  });
}

async function runCode(editor) {
  if (isRunning) return; // ignore clicks while a run is in progress
  isRunning = true;

  runButton.disabled = true;
  runButton.textContent = "Running...";
  clearOutput();

  // Result shape kept stable for a FUTURE auto-check layer to consume.
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
    isRunning = false;
    runButton.disabled = false;
    runButton.textContent = "Run";
    setStatus(result.ok ? "Finished" : "Finished with an error");
  }

  // FUTURE (auto-check): hand `result` plus the captured output to a
  // checker here, then render pass/fail into the .pyenv__check slot.
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

/* ---- Boot ---------------------------------------------- */

// Initialize only when the playground markup is present. Running this
// after all declarations avoids referencing consts before they exist.
function initPlayground() {
  const editor = createEditor();
  wireThemeSync(editor);
  wireRunButton(editor);
  preloadPyodide();
}

if (editorMount && outputEl && runButton) {
  initPlayground();
}
