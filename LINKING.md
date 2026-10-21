# Linking Indago to the Greatstone website

John decided on 20 October 2026 that Indago will remain a separate portal for now and later mount at `/portal/indago` on the Greatstone website. The intended private address is `indago.greatstoneint.com`; the preview still uses `greatstone-indago-portal.netlify.app`. This file records the integration boundary; it does not authorise a database move or DNS change.

## What moves

Move `src/indago/` into the website app. It contains the screens, model, record store, browser API client and local demo fixture. The website shell mounts `IndagoApp` with `{ state, canEdit, actions }`; `src/App.jsx` in this repo shows the current adapter. Mount the Netlify route in `netlify/functions/indago.mjs` and its Indago request code in `netlify/functions/indago/`. Keep the `indago` schema and its migrations in `netlify/database/migrations/` as a distinct migration set. Reconcile migration numbers with the website before applying them there.

## What is shared

The website owns Better Auth sessions and the `user`, `session`, `account` and verification tables. Indago keeps `indago.members` for workspace invitations and Editor or Viewer permissions. The website's auth service must accept a Greatstone invitee before Indago checks workspace membership; the current stand-alone auth hook checks `indago.members` because this site serves only Indago. The verified user ID continues to be set inside each request transaction before the restricted `indago_app` role queries the schema. Keep the database RLS and audit tests when moving the functions.

The website supplies its published footer and legal links. This stand-alone footer follows the current public website: it links home and the Greatstone contact address, and shows no draft legal page. When the website publishes legal pages, pass its published legal links to `GreatstoneFooter`, or use the website's footer component directly. Do not invent legal URLs for draft pages.

Email uses the Greatstone Resend account and a verified `greatstoneint.com` sender. Each site gets its own sending-only key restricted to that domain. The Indago key belongs only in this site's function secrets; the full account key stays in GS Agentic Manager. The website can use its own restricted key when the module moves. A signed-in user should stay signed in when navigating between website and portal after the auth move; test cookie domain, callback URL and sign-out across both routes before retiring this stand-alone site.

## Steps before the link goes live

1. Merge the website's Netlify Database and auth work first. Review its user schema, migration order and published legal links.
2. Copy the Indago module and function adapter. Replace the stand-alone account-creation hook with the website's invitation flow; keep `indago.members` as the workspace gate. Disable and remove the synthetic preview password route and its two `.test` accounts before any real import.
3. Migrate the `indago` schema with a backup and a rollback plan. Re-run the local RLS tests against the combined schema, then have Flint review the auth and database boundary. Never use the old Supabase projects.
4. Set the website's restricted Resend key and verified sender, the Better Auth URL and the `/portal/indago` callback. Test an invited Editor, a Viewer and an uninvited account in two browsers; check audit history and locked fields.
5. Set `indago.greatstoneint.com` to the approved private destination only after review. Keep `noindex` and do not add a public navigation link.
