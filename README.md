# Indago portal

Private stand-alone React 18 and Vite app for the Indago project (GRE-1683). It uses its own Supabase project, Auth users and email-link sign-in. It is a separate service-delivery app.

## Local use

Create a local `.env` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for a **local or test** Supabase project. Only the publishable key may enter Vite. Never use a service key in the browser or commit an `.env` file.

```sh
npm ci
npm run dev
npm run preflight
```

The app uses `/portal/indago`; `/indago` is a short redirect. `netlify.toml` sets `npm run build`, the `dist` publish folder and a `noindex` header; `public/_headers` supplies the same header and other basic headers. The app has no public-site link. Hosting must be private, and the Supabase `indago` schema must be exposed to its data API after the migration. Register the private site's URL as a permitted Supabase auth redirect before testing email links.

## Database and source import

Target project: `ydribsrasdwahqtxacwz`. Do not apply these migrations to the website database. This project is on the Free plan. GRE-1697 owns the backup decision, production migration and import; take a manual database dump or obtain John's decision before either live write. Use a local or test project for checks. Flint must review the changed schema and RLS first.

The migrations are `supabase/migrations/0001_indago_schema.sql`, `0002_indago_editor_rows.sql` and `0003_indago_history_actor.sql`, applied in that order to a fresh Supabase project. They depend only on that project's standard `auth.users` and `auth.uid()`. `0001` creates the `indago` schema, four tables, two membership helpers and an audit trigger. `0002` permits invited Editors to add risks and derived register rows, and stores portal controls as audited edits. `0003` gives invited users the actor email for audited history through a restricted function. Matching files in `supabase/rollback/` reverse each step. The `0002` rollback leaves existing editor-created rows in place; the `0001` rollback drops the whole schema. Export real data and confirm a restore point before rolling back `0001`.

The three GRE-1681 source instruments and approved v1 HTML stay outside Git. `scripts/prepare-import.py` reads both workbooks by sheet name, validates the Delivery Toolkit document, and takes the v1 HTML's structured Toolkit state for the seven screens. It validates 41 work packages, 6 gates, 140 findings and 31 requests, then writes a private SQL import file. The attachments' workbook labels are reversed, so sheet names determine their roles. Example: `python3 scripts/prepare-import.py plan.xlsx register.xlsx toolkit.docx portal.html import.sql`. The output contains client text. Keep it in a protected temporary location, apply it through an authorised database connection, and delete it after verification. The first five columns of Client Findings and first three of Information Requests are locked in the database. Editors can save overlay values only for the remaining columns; Viewers can read but cannot write. An administrator provisions named people in `indago.members` after their Supabase auth users exist. No browser can invite itself.

`supabase/tests/rls.sql` is an isolated PostgreSQL check with a local auth shim. It covers uninvited reads, Viewer writes, locked client fields, Editor saves and inserts, and change history. Run it against a fresh local PostgreSQL database with `psql -v ON_ERROR_STOP=1 -f supabase/tests/rls.sql`. It must never run against production because it creates test roles and synthetic users.

The browser reloads shared records every 3 seconds. Saves use the record version to detect another editor's change. CSV exports are snapshots and escape spreadsheet formulas. The database stays the master copy.

## Publish checklist

GRE-1697 owns the live steps after review: set the two `VITE_` public values to the Indago project, allow the private site's auth callback, test as two invited users, then set `indago.greatstoneint.com` DNS. The private site must retain sign-in and `noindex`.
