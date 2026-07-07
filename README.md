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
│   └── about.html
├── server.js            # Express entry point
├── package.json
└── .gitignore
```

## Deploying to Render
See the project setup notes for step-by-step instructions.
The `start` script and `PORT` env var are already wired up for Render.
