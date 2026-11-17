# Magnate LiveOps

Real-time visibility of bunker operations. The Magnate operations desk updates an operation once; owners, charterers, traders, suppliers, masters and surveyors each follow it through their own link, with no account.

## Run it locally

Requires Node 22.18 or newer.

```sh
npm install
npm run dev
```

Open http://localhost:4100. The desk passcode in development is `magnate`. The first run creates four sample operations; http://localhost:4100/demo opens one as a vessel owner sees it.

With no database configured, data is kept in a local file (`data/liveops.db`). Settings live in `.env`; see `.env.example`.

## Host it on Vercel + Supabase

### 1. Supabase (database and instant updates)

1. Create a project at supabase.com.
2. Open **Connect** and copy the **Transaction pooler** connection string (port 6543). Put your database password in place of `[YOUR-PASSWORD]`. Do not use the "Direct connection" string: it is IPv6-only and Vercel cannot reach it.
3. From **Project Settings > API**, note the project URL and the publishable (anon) key.

The app creates its own tables on first use, in a `liveops` schema with row level security on, so they are not readable through Supabase's public API.

### 2. Vercel

1. Push this repository to GitHub and import it in Vercel. The included `vercel.json` sets the build.
2. Add these environment variables in the Vercel project settings:

| Name | Value |
|---|---|
| `ADMIN_PASSCODE` | A strong passcode for the operations desk |
| `DATABASE_URL` | The Transaction pooler connection string, with password |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Your Supabase publishable (anon) key |
| `SEED_DEMO` | `1` if you want the four sample operations created (optional) |

3. Deploy, then add your domain under **Settings > Domains**.

### Notes on the free plans

- Vercel's Hobby plan is for non-commercial use; check their terms for business use.
- Supabase pauses a free project after about a week without activity. Un-pause it from the Supabase dashboard; no data is lost.

## How it works

- **Storage:** each operation is one row in Postgres. Share-link usage (opens, last seen) is kept separately, so viewers never overwrite desk edits. Saves are version-checked, so two people updating the same operation at once cannot lose each other's changes.
- **Updates:** every open page re-checks the server on a timer while its tab is visible. When Supabase Realtime is configured, the server also announces each change, and pages refresh in well under a second. The announcement carries no data.
- **Sign-in:** the desk passcode issues a signed cookie; changing the passcode signs everyone out.
- **Share links:** the link is the key. Each link returns only the sections its party may see (`ROLE_MODULES` in `shared/domain.ts`), filtered on the server.

## What is in it

**Operations desk** (`/console`)

- Operations list across Colombo, Galle, Hambantota and Trincomalee, with delayed operations surfaced first
- Per operation: post an update (to all parties or chosen ones), revise the ETA, report or clear a delay, tick milestones, set readiness, record delivered quantity, keep the document checklist, write remarks for the report
- One share link per party, showing how often it has been opened and whether it is being viewed now; a link can be switched off or replaced

**Live board** (`/live/<token>`)

- Current status, latest ETA with countdown and drift, delay status, estimated completion
- Fourteen milestones in four phases, update feed, ETA history with chart, readiness, delivery progress, documents, parties
- Light and dark themes, and a phone layout

**Report** (`/live/<token>/report` or from the console): laid out for A4 print or PDF.

## Layout

```
shared/domain.ts     data model, role visibility, time formatting
server/app.ts        the API (runs locally and as the Vercel function)
server/store-*.ts    Postgres and SQLite storage
server/realtime.ts   change announcements through Supabase Realtime
api/index.js         Vercel entry point
src/                 React front end
```

All times are shown in Sri Lanka local time (UTC+05:30).

## Not in this version

- Individual staff accounts: the desk shares one passcode, with a name for attribution
- File uploads: the checklist records status and reference numbers only
- Email or WhatsApp notifications
