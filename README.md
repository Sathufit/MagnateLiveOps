# Magnate LiveOps

Real-time visibility of bunker operations. The Magnate operations desk updates an operation once; owners, charterers, traders, suppliers, masters and surveyors each follow it through their own link, with no account.

## Run it

Requires Node 22.18 or newer (built on Node 24).

```sh
npm install
npm run dev
```

Open http://localhost:4100. In development the desk passcode is `magnate`. The first run creates four sample operations; http://localhost:4100/demo opens one of them as a vessel owner sees it.

For production:

```sh
cp .env.example .env     # set ADMIN_PASSCODE
npm run build
npm start
```

Put it behind HTTPS (nginx, Caddy or a platform proxy). Data is a single SQLite file at `data/liveops.db`; back that file up.

## What is in it

**Operations desk** (`/console`, passcode)

- Operations list across Colombo, Galle, Hambantota and Trincomalee, with delayed operations surfaced first
- Per operation: post an update, revise the ETA, report or clear a delay, tick milestones (times can be corrected), set party readiness, record delivered quantity, keep the document checklist, write remarks for the report
- Updates can go to all parties or only to chosen ones
- One share link per party, showing how often it has been opened and who is viewing right now; a link can be switched off or replaced

**Live board** (`/live/<token>`, no login)

- Current status, latest ETA with countdown and drift against the first ETA, delay status, estimated completion
- Fourteen milestones in four phases, the update feed, ETA history with a chart, readiness, delivery progress, documents, parties
- Updates arrive on their own; nobody needs to refresh
- Each party sees the sections relevant to its role (the matrix is `ROLE_MODULES` in `shared/domain.ts`); filtering happens on the server
- Light and dark themes, and a layout for phones

**Report** (`/live/<token>/report` or from the console)

- Key times, performance figures, milestone timeline, ETA record, delays, documents, remarks and the full update log, laid out for A4 printing or saving as PDF

## Layout

```
shared/domain.ts   data model, role visibility, time formatting (used by server and browser)
server/            Express API, SQLite storage, live streams, sample data
src/               React front end
```

All times are shown in Sri Lanka local time (UTC+05:30); hovering a time shows it in the viewer's own zone.

## Not in this version

- Individual staff accounts: the desk shares one passcode, and each person signs in with their name for attribution
- File uploads: the document checklist records status and reference numbers, not the files themselves
- Email or WhatsApp notifications: parties see updates when the board is open
