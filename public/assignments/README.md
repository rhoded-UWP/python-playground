# How to create Python Playground assignments

This folder holds the assignments for the **Python Programming Playground**
page (`/programming-playground.html`). This document explains the data format
so that **both humans and AI coding assistants** can add or edit assignments
correctly without touching any application code.

> **For AI assistants:** This is the authoritative spec. Follow it exactly.
> Do **not** hardcode assignments in JavaScript — they are data files only.
> The frontend reader is `public/js/playground.js`; the server route is in
> `server.js`. Validate any file you create with `JSON.parse` before finishing.

---

## How the system works

- Each assignment is **one `.json` file** in this folder
  (`public/assignments/`).
- The server route **`GET /api/assignments`** (in `server.js`) reads this
  folder **fresh on every request** and returns the files in **filename
  order**. So adding an assignment needs **no code change and no restart** —
  just add a file.
- The page (`public/js/playground.js`) fetches that list on load and builds
  the left rail (the picker), the editor starter code, and the right panel
  (instructions + the **Test Code** tester).
- The assignment number shown in the rail (`1 ·`, `2 ·`, …) is added
  **automatically from file order**. Do **not** put a number in `name`.

### Ordering and naming convention

Use a two-digit numeric prefix so the order is obvious and "Open Playground"
stays first:

```
01-open.json
02-hello.json
03-welcome.json
04-your-new-assignment.json   <-- add new files like this
```

---

## File schema

A complete assignment file. Fields marked **required** must be present.

| Field          | Required | Type                    | Purpose                                                        |
| -------------- | -------- | ----------------------- | -------------------------------------------------------------- |
| `id`           | yes      | string                  | Unique short id (letters, numbers, dashes). Used internally.   |
| `name`         | yes      | string                  | Title shown in the rail and as the panel heading. **No number.** |
| `blurb`        | no       | string                  | One-line subtitle under the name in the rail.                  |
| `starter`      | no       | string **or** string[]  | Code pre-filled in the editor. An array is joined with newlines. |
| `instructions` | no       | string **or** string[]  | HTML shown in the right panel. An array is joined with newlines. |
| `tests`        | no       | array                   | Checks run by the **Test Code** button. Empty/omitted = no tester (free play). |

### `starter` and `instructions`: string or array

Both accept either a single string or an **array of lines** (joined with `\n`).
The array form is just for readability in the JSON — prefer it for anything
multi-line.

`instructions` is **HTML** and is inserted as-is. You may use: `<p>`,
`<ol>`/`<ul>`/`<li>`, `<code>`, `<pre><code>…</code></pre>` (for code blocks),
`<strong>`, `<em>`. Add `class="pyenv__note"` to a `<p>` for muted small print.

> Security note: `instructions` is trusted content authored by you. Only put
> assignment text here — never student input or untrusted data.

---

## Tests

`tests` is an array. Each test has a `name` (shown next to the ✓ / ✗) and a
`type` of either `"source"` or `"output"`. Tests run top to bottom when the
student clicks **Test Code**.

### `type: "source"` — checks the code text (does NOT run it)

Use it to check technique ("did they use a loop?"). Provide **one** matcher:

| Field      | Type    | Meaning                                                         |
| ---------- | ------- | --------------------------------------------------------------- |
| `pattern`  | string  | A JavaScript regular expression tested against the code.        |
| `contains` | string  | A plain substring that must appear in the code.                 |
| `flags`    | string  | Optional regex flags, e.g. `"i"` for case-insensitive.          |
| `negate`   | boolean | Optional. `true` flips the result (passes when **not** matched). |

**Important:** In JSON, backslashes must be **doubled**. To match the word
`for`, write `"pattern": "\\bfor\\b"`.

```jsonc
{ "name": "Uses a for loop",        "type": "source", "pattern": "\\bfor\\b" }
{ "name": "Calls print()",          "type": "source", "pattern": "\\bprint\\s*\\(" }
{ "name": "Does not use while",     "type": "source", "contains": "while", "negate": true }
```

> Source checks look at raw text, so a word can technically match inside a
> comment or string. They are a light technique check — the **output test** is
> what proves the program actually works.

### `type: "output"` — runs the program and checks what it prints

The program runs with `input` fed to `input()` calls in order, and its printed
output must match `expected` **exactly** (character-for-character).

| Field      | Type                   | Meaning                                                       |
| ---------- | ---------------------- | ------------------------------------------------------------- |
| `input`    | string[]               | One string per `input()` call, in order. Omit/`[]` if none.   |
| `expected` | string **or** string[] | The exact required output (see the two forms below).          |

**Two ways to write `expected`:**

1. **Array of lines** — joined with newlines **and given a trailing newline**.
   This matches the common "one `print()` per line" case.
   `["1","2","3"]` means the program prints `1`, `2`, `3` on three lines
   (i.e. `"1\n2\n3\n"`).

2. **String** — used **verbatim**. Use this when the output is not simply one
   line per `print()` — for example when an `input()` prompt (which has **no**
   trailing newline) runs straight into the next line of output.

```jsonc
{ "name": "Prints 1 to 5", "type": "output", "input": [], "expected": ["1","2","3","4","5"] }
```

---

## Gotchas (read before writing output tests)

- **`print()` adds a newline.** `print("Hi")` produces `"Hi\n"`, not `"Hi"`.
  The array form of `expected` adds that trailing newline for you; a string
  must include it explicitly.
- **`input(prompt)` writes the prompt to stdout with NO trailing newline.**
  So the prompt text merges onto the same line as whatever prints next. When a
  program uses `input()`, prefer the **string** form of `expected` and write
  the merged line exactly. (See `03-welcome.json` for a real example.)
- **Imports are blocked** in the playground. Assignments cannot rely on
  modules. If student code contains an import, every test reports it and fails.
- **Exact match is case- and space-sensitive.** A failing output test shows an
  "Expected vs. Your output" diff with `⏎` marking each newline, so a missing
  or extra newline is visible.
- **Malformed JSON is skipped, not fatal.** If a new assignment doesn't appear,
  check the server terminal — a parse error is logged with the filename.

---

## Copy-paste template

```json
{
  "id": "unique-id-here",
  "name": "Assignment Title",
  "blurb": "Short one-line description",
  "starter": [
    "# Instructions in a comment, then a blank line to type in.",
    ""
  ],
  "instructions": [
    "<p>Explain what the student should do.</p>",
    "<ol>",
    "<li>First step</li>",
    "<li>Second step, mentioning <code>print()</code> or <code>input()</code></li>",
    "</ol>"
  ],
  "tests": [
    { "name": "Uses print()", "type": "source", "pattern": "\\bprint\\s*\\(" },
    { "name": "Prints the right thing", "type": "output", "input": [], "expected": ["expected line one"] }
  ]
}
```

---

## Worked example: a program that uses input()

For a program like:

```python
print("Welcome to Python Playground")
user = input("Please enter your name?")
print("Welcome", user, "You will learn a lot about Python here!")
```

…run with the name `Ada` typed in, the exact stdout is:

```
Welcome to Python Playground
Please enter your name?Welcome Ada You will learn a lot about Python here!
```

Note how `Please enter your name?` (the prompt) sits on the **same line** as
`Welcome Ada …` because the prompt has no trailing newline. That is why the
output test below uses the **string** form of `expected`:

```jsonc
{
  "name": "Greets the entered name correctly (entered \"Ada\")",
  "type": "output",
  "input": ["Ada"],
  "expected": "Welcome to Python Playground\nPlease enter your name?Welcome Ada You will learn a lot about Python here!\n"
}
```

---

## Checklist before you finish

- [ ] File is named `NN-short-name.json` with a two-digit order prefix.
- [ ] `id` is unique across all files in this folder.
- [ ] The file is valid JSON (no trailing commas, backslashes doubled in regex).
- [ ] Every output test's `expected` accounts for `print()`'s trailing newline.
- [ ] If the program uses `input()`, `input` has one entry per `input()` call.
- [ ] Verified in the browser: the assignment appears, Run works, and each test
      shows the expected ✓ / ✗.
```
