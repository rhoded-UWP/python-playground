# Problem Sets: how to author one

This folder holds the problem sets for the Problem Sets page. Each file is
plain JSON. The server reads this folder fresh on every request, so
**publishing a new problem set is just dropping a JSON file in here.** No
code change and no restart.

Crucially, this folder lives **outside** `/public`, so the files are never
served to students. The browser only ever receives an answer-free "public
shape" (built in `lib/loader.js`) plus a per-line correct/incorrect verdict.
The correct answers stay on the server.

## The one rule that keeps answers safe

Put the answers in the file using the `answer` / `answers` / row `hint`
fields described below. The loader copies **only display fields** into the
public shape, so anything you add to a row that is not a known display field
never reaches the browser. You do not have to do anything special to hide an
answer. Just keep the data in this folder.

## Sets and parts

- A **set** is what shows up as one slot in the left rail (for example
  "PS 2 - Hello, Problem Sets!"). It has one Submit button and produces one
  PNG.
- A **part** is one section inside a set, and it is **one file**. Parts that
  share the same `setId` are grouped into the same set automatically.

So PS2 is five files (`ps2-concatenators.json`, `ps2-datatypes.json`,
`ps2-tracing-1.json`, `ps2-tracing-2.json`, `ps2-tracing-3.json`) that all
use `"setId": "ps2"`. A set that is just one section is just one file.

### Set-level fields (put these on at least one part file in the set)

| Field      | Meaning                                                        |
| ---------- | -------------------------------------------------------------- |
| `setId`    | Groups parts. Also the URL: `problem-sets.html?set=ps2`.       |
| `setTitle` | Title shown in the rail and atop the activity.                 |
| `order`    | Which numbered slot (1..20) the set fills.                     |
| `demo`     | `true` puts the set in the Demos group instead of a number.    |

It is simplest to repeat `setId`, `setTitle`, and `order` in every part file
of a set. The loader is happy either way; it reads each set-level value from
the first part that has it.

### Part-level fields (every file)

| Field          | Meaning                                                  |
| -------------- | -------------------------------------------------------- |
| `id`           | Unique id for this part. Used when checking answers.     |
| `part`         | Section heading shown in the activity.                   |
| `partOrder`    | Order of this part within its set (1, 2, 3, ...).        |
| `type`         | One of the five types below.                             |
| `instructions` | A string, or an array of strings (one line each).        |
| `rows`         | The graded rows (shape depends on `type`).               |

**Points are automatic.** A part is worth one point per graded field per
row. You never count points by hand. (predict-output is 1 per row;
valid-invalid-type is 2 per row; variable-trace is one per tracked column.)

## The five types, with a filled-in mini example each

Every row needs a unique `id` (just use "1", "2", "3", ...). Answers are
exact string matches, so type them exactly as a student must: spacing, case,
and quotation marks all matter. For string values in a tracing answer,
include the quotes inside the string, like `"\"a\""`.

### 1. `predict-output`

Student reads a snippet and types the printed output. Use `"error"` as the
answer for code that is not valid Python.

```json
{
  "setId": "ps9", "setTitle": "Printing", "order": 9,
  "id": "ps9-print", "part": "Predict the output", "partOrder": 1,
  "type": "predict-output",
  "instructions": "Type the exact output. Type error if it is not valid Python.",
  "rows": [
    { "id": "1", "code": "print(\"hi\", \"there\")", "answer": "hi there" },
    { "id": "2", "code": "print(nope)", "answer": "error" }
  ]
}
```

### 2. `valid-invalid-type`

Student marks Valid/Invalid and picks a data type. Each row needs both
answers. `validity` must be `"Valid"` or `"Invalid"`. `dataType` is one of
`string`, `integer`, `float`, `boolean`.

```json
{
  "setId": "ps9b", "setTitle": "Identifiers", "order": 10,
  "id": "ps9b-types", "part": "Valid vs Invalid", "partOrder": 1,
  "type": "valid-invalid-type",
  "instructions": ["Valid or Invalid?", "Then pick the data type."],
  "rows": [
    { "id": "1", "code": "score = 10",
      "answers": { "validity": "Valid", "dataType": "integer" } },
    { "id": "2", "code": "2cool = True",
      "answers": { "validity": "Invalid", "dataType": "boolean" } }
  ]
}
```

### 3. `variable-trace`

Student traces one or more variables. List the tracked variables in
`columns`; give each row an answer per column. Use `"-"` for a variable that
is not defined yet.

```json
{
  "setId": "ps9c", "setTitle": "Tracing", "order": 11,
  "id": "ps9c-trace", "part": "Trace two variables", "partOrder": 1,
  "type": "variable-trace",
  "instructions": ["Use a dash - if a variable is not defined yet.",
                   "Include quotes for strings, like \"a\"."],
  "columns": ["foo", "bar"],
  "rows": [
    { "id": "1", "code": "foo = 3", "answers": { "foo": "3", "bar": "-" } },
    { "id": "2", "code": "bar = \"a\"", "answers": { "foo": "3", "bar": "\"a\"" } }
  ]
}
```

### 4. `free-form`

Student writes a line of Python, checked by exact string match for now.
Optional `starter` prefills the input; optional `hint` shows only on a wrong
answer.

> Note for later: this is the type where an execution-based checker (run the
> line and compare behavior) would replace the exact match. The seam is
> marked in `lib/loader.js` on the `free-form` type and in `problem-set.js`.

```json
{
  "setId": "ps9d", "setTitle": "Write Python", "order": 12,
  "id": "ps9d-write", "part": "Write the line", "partOrder": 1,
  "type": "free-form",
  "instructions": "Write one line of Python for each row.",
  "rows": [
    { "id": "1", "prompt": "Print the word hello in double quotes.",
      "answer": "print(\"hello\")", "hint": "Use print() with double quotes." }
  ]
}
```

### 5. `caesar-cipher`

Character-by-character encrypt or decrypt. Set the `shift` and `direction`
(shown to the student); each row is one character with its shifted answer.

```json
{
  "setId": "ps9e", "setTitle": "Caesar", "order": 13,
  "id": "ps9e-enc", "part": "Encrypt with shift 3", "partOrder": 1,
  "type": "caesar-cipher",
  "shift": 3, "direction": "encrypt",
  "instructions": "Shift each letter forward 3. Letters wrap, so X becomes A.",
  "rows": [
    { "id": "1", "char": "H", "answer": "K" },
    { "id": "2", "char": "I", "answer": "L" }
  ]
}
```

## Quick checklist before you publish

- [ ] File is valid JSON (a trailing comma will make the loader skip it; the
      server log will tell you which file and why).
- [ ] `setId`, `id`, `type`, and `rows` are present.
- [ ] `setTitle` and `order` are on at least one part of the set.
- [ ] Every row `id` is unique within the part.
- [ ] Answers are typed exactly as a student must enter them (spaces, case,
      quotes).
- [ ] Reload the Problem Sets page. The set appears; no restart needed.

## Where the code is, if you need it

- `lib/loader.js` reads and groups these files and builds the public shape.
  Add a new `type` here (one entry in the `TYPES` map) plus a renderer in
  `public/js/problem-set.js` to support a new kind of problem.
- `lib/validator.js` is the single place the answer-matching rule lives.
  Loosen matching there (and only there) if you ever want to.
- `server.js` exposes `/api/sets`, `/api/sets/:setId`, and
  `/api/sets/:setId/check`.
