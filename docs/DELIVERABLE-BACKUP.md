# Work-package file restore points

Netlify Database snapshots cover the file metadata and change history. They do **not** include Netlify Blobs. The `indago-deliverables` Blob store keeps 3 MB file chunks, including chunks for soft-deleted files.

Before a production migration or restore, take a Netlify Database snapshot and export the Blob store at the same time. From an authorised shell, set `NETLIFY_SITE_ID` and `NETLIFY_AUTH_TOKEN`, then run `node scripts/deliverable-archive.mjs backup /absolute/path/on/encrypted/storage/restore-point-name`. The archive command creates a new directory, downloads every chunk, and writes a SHA-256 manifest. Keep the directory and the matching database snapshot together, outside Git. Do not post the archive or its contents to a task.

For recovery, restore the matching Netlify Database snapshot first. Then, after the restore has been approved, run `INDAGO_RESTORE_FILES=1 node scripts/deliverable-archive.mjs restore /absolute/path/on/encrypted/storage/restore-point-name` with the same site credentials. The script verifies the archive checksums before writing chunks. Finally, check one known file through the portal's authenticated download route. A database-only restore can leave metadata pointing to missing file chunks.

The script has not been run against production files as part of GRE-1777. The owner of the production restore point must run and retain its first archive before live files are accepted.
