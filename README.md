# Indago portal

Private stand-alone React 18 and Vite app for the Indago project (GRE-1683). It uses the Greatstone website's Supabase project and email-link sign-in. The screens and data layer are kept in `src/` so the later website client portal merge is a copy of the module, not a new build.

## Local use

Create a local `.env` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for a **local or test** Supabase project. Only the publishable key may enter Vite. Never use a service key in the browser or commit an `.env` file.

```sh
npm ci
npm run dev
npm run preflight
```

The app uses `/portal/indago`; `/indago` is a short redirect. Netlify's `public/_headers` sends `noindex` and other basic headers. The app has no public-site link. Hosting must be private, and the Supabase `indago` schema must be exposed to its data API after the migration. Register the private site's URL as a permitted Supabase auth redirect before testing email links.

## Database and source import

Target project: `melnjvwmayjukpyngolv`. Check that this project has the agreed daily backup coverage **before** applying a migration or importing client data. Use a local or test project for checks. Production changes need Flint's schema review and the owner's release action.

The numbered migrations are `supabase/migrations/0041_indago_schema.sql` and `supabase/migrations/0042_indago_editor_rows.sql`. Apply them in that order, then run the private source import. `0041` adds only the `indago` schema, four tables, two membership helpers and an audit trigger. `0042` permits invited Editors to add risks and derived register rows, and stores the portal controls as audited overlay edits. Its rollback is `supabase/rollback/0042_indago_editor_rows_down.sql`; the `0041` rollback drops the whole schema. Export real data and confirm a restore point before rolling back `0041`. When this code is merged into the website later, carry both migrations and rollback files across, preserving applied versions or renumbering only if the website has already used those numbers.

The three GRE-1681 source instruments and approved v1 HTML stay outside Git. `scripts/prepare-import.py` reads both workbooks by sheet name, validates the Delivery Toolkit document, and takes the v1 HTML's structured Toolkit state for the seven screens. It validates 41 work packages, 6 gates, 140 findings and 31 requests, then writes a private SQL import file. The attachments' workbook labels are reversed, so sheet names determine their roles. Example: `python3 scripts/prepare-import.py plan.xlsx register.xlsx toolkit.docx portal.html import.sql`. The output contains client text. Keep it in a protected temporary location, apply it through an authorised database connection, and delete it after verification. The first five columns of Client Findings and first three of Information Requests are locked in the database. Editors can save overlay values only for the remaining columns; Viewers can read but cannot write. An administrator provisions named people in `indago.members` after their Supabase auth users exist. No browser can invite itself.

`supabase/tests/rls.sql` is an isolated PostgreSQL check with a local auth shim. It covers uninvited reads, Viewer writes, locked client fields, Editor saves and inserts, and change history. Run it against a fresh local PostgreSQL database with `psql -v ON_ERROR_STOP=1 -f supabase/tests/rls.sql`. It must never run against production because it creates test roles and synthetic users.

The browser reloads shared records every 3 seconds. Saves use the record version to detect another editor's change. CSV exports are snapshots and escape spreadsheet formulas. The database stays the master copy.

## Publish checklist

After the migration, data import and reviews: configure a private Netlify site for this repository, set only the two `VITE_` public values, allow its auth callback in Supabase, test as two invited users, then set `indago.greatstoneint.com` DNS. John owns DNS and account settings. Publishing the private address is separate from merging this module into the public website client portal.
