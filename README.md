# Python Playground

Classroom site for Python learning — interactive playground, problem sets, attendance activities, and contest pages (APRC, AWPC).

https://python-playground-1x2z.onrender.com/index.html




## Stack
- **Frontend:** static HTML / CSS / vanilla JS (in `/public`)
- **Backend:** Node.js + Express (`server.js`)
- **Hosting:** Render
- **Version control:** GitHub

## Local development

```bash
npm install
npm run dev   # auto-reload on file changes (Node 18+)
# or
npm start
```

Then open <http://localhost:3000>.

## Project structure

```
.
├── public/              # static frontend served by Express
│   ├── css/styles.css
│   ├── js/main.js
│   ├── index.html       # Home
│   ├── programming-playground.html
│   ├── problem-sets.html
│   ├── attendance.html
│   ├── aprc.html
│   ├── awpc.html
│   ├── python-arcade.html
│   ├── about.html
│   └── dashboard.html   # usage dashboard
├── lib/                 # server-only modules (problem sets, analytics, db)
├── server.js            # Express entry point
├── package.json
└── .gitignore
```

## Usage dashboard (`/dashboard.html`)

An anonymous usage dashboard: page views, code runs, assignments completed,
lines of Python written (today / 7 days / 30 days / all time), when students
code, the problem-set lines students miss most, and common Python errors.

- **Server:** `lib/analytics.js` (page-view counter, `POST /api/events`,
  `GET /api/stats?days=7|30|90`) and `lib/db.js` (Postgres connection; creates
  the `events` table automatically on startup).
- **Browser:** `window.ppTrack()` in `public/js/main.js`; the Playground calls
  it on Run and Test Code. Problem-set checks are recorded on the server.
- **Privacy:** no names, accounts, IP addresses, cookies, or browser IDs are
  stored. Each row is one anonymous action.

| Environment variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes, to turn tracking on | Postgres connection string. On Render use the database's **Internal Database URL**. Without it, tracking is off and the site runs normally. |
| `ANALYTICS_TZ` | no | Time zone for days and hours. Default `America/Chicago`. |
| `PGSSL` | no | `require` or `disable` to override automatic TLS detection. |

## Deploying to Render
See the project setup notes for step-by-step instructions.
The `start` script and `PORT` env var are already wired up for Render.
