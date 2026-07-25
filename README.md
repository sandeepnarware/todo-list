# PomoDone

A personal productivity system with task management, Pomodoro focus sessions, quarterly goals, and analytics — built as a single-page PWA for GitHub Pages.

## Features

- **Task Management** — tasks with priorities, projects, tags, due dates, and recurring schedules
- **Pomodoro Timer** — 25 min focus / 5 min break cycles with progress ring, PiP mode, and session tracking
- **Golden Task** — mark your most important task and keep it front and center
- **Quarterly Goals** — set and track goals month by month
- **Analytics** — calendar heatmap, 24-hour distribution chart, and time-slot breakdown
- **Dark/Light Themes** — toggleable, persisted preference
- **PWA** — installable, works offline

## Usage

Open `index.html` in any browser or visit the GitHub Pages URL.

## Deploy

Push to `main` and enable Pages in repo settings → Source: **GitHub Actions**.

## Versioning

The version shown in the sidebar comes from `version.json`.

- **`major` / `minor`** — edit by hand in `version.json` when you want to mark a
  bigger change.
- **`patch`** — do **not** edit. The deploy workflow stamps it on every release
  from the commit count on `main`, along with the short commit sha and release
  date (both shown on hover). The stamp applies to the deployed artifact only,
  so nothing is committed back and no extra deploy is triggered.

Locally the committed `patch: 0` / `commit: "local"` values are what you see.
