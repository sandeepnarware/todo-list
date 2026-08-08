# PomoDone

A personal productivity system with task management, Pomodoro focus sessions, quarterly goals, and analytics — built as a single-page PWA for GitHub Pages.

## Features

- **Task Management** — tasks with priorities, projects, tags, due dates, and recurring schedules
- **Due Filter** — narrow the task list to what is due today, tomorrow, this week, or this month (overdue work included)
- **Inline Rescheduling** — click a task's 📅 badge for a pop-up calendar with Today / Tomorrow / Next week presets; no edit form needed
- **Pomodoro Timer** — 25 min focus / 5 min break cycles with progress ring, PiP mode, and session tracking
- **Calendar** — month/week/day views; block out time for a task, or add an event that never becomes one
- **Golden Task** — mark your most important task and keep it front and center
- **Quarterly Goals** — set and track goals month by month
- **Analytics** — calendar heatmap, 24-hour distribution chart, and time-slot breakdown
- **Dark/Light Themes** — toggleable, persisted preference
- **PWA** — installable, works offline

## Usage

Open `index.html` in any browser or visit the GitHub Pages URL.

## Deploy

Push to `main` and enable Pages in repo settings → Source: **GitHub Actions**.

## Tests

```
npm install     # dev-only: jsdom + css-tree
npm test        # all suites + stylesheet audits
npm run test:verbose
```

Suites live in `tests/` and run the real `index.html` / `app.js` / `style.css` in
jsdom — there is no build step and nothing is mocked except the network. Two of
them are stylesheet audits rather than behaviour tests:

- `control-audit.js` resolves the CSS cascade (specificity, source order,
  `!important`, inline styles, **and the `@tailwindcss/forms` base layer**) for
  every form control in both themes, and fails on any control that falls back to
  a browser default, uses a hard-coded colour, or is the same colour as its
  container.
- `token-audit.js` fails if a bright theme token used as a surface or focus ring
  has no dark-mode override, or if `color-scheme` isn't declared.

`npm test` runs on every push and pull request, and the deploy is gated on it.

## Versioning

The version shown in the sidebar comes from `version.json`.

- **`major` / `minor`** — edit by hand in `version.json` when you want to mark a
  bigger change.
- **`patch`** — do **not** edit. The deploy workflow stamps it on every release
  from the commit count on `main`, along with the short commit sha and release
  date (both shown on hover). The stamp applies to the deployed artifact only,
  so nothing is committed back and no extra deploy is triggered.

Locally the committed `patch: 0` / `commit: "local"` values are what you see.
