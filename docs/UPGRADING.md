# Reviewing and deploying G-Track 2.0

## Current review state

- Branch: `codex/g-track-2-redesign`, based on the existing repository's `main` (d094087).
- Existing GitHub Pages production is unchanged. The PR is not merged.
- The new migration was generated with the Supabase CLI and is committed for review at `supabase/migrations/20261115171330_gtrack_v2_training.sql`.
- That migration was executed only in isolated PostgreSQL/WASM tests, **not on the hosted project**. No production workout rows were changed or seeded during redesign verification.
- A v2 client checks `gtrack_api_version()` before any cloud write. An unmodified v1 backend produces “Cloud upgrade required”; pending work stays on the device. This is intentional during review.

## Review preview

Run the source server from this branch as described in README. Use `/tests/preview.html` for synthetic local-only screens. It generates a new database each time, avoiding the normal app cache and personal data. The `db=` development override is accepted only on localhost with a `gtrack-qa-*` or `gtrack-test-*` name; production ignores it.

Alternatively, download `g-track-preview` from the PR's successful Actions run and serve its extracted files with a static HTTP server. It contains no demo history. PR builds do not deploy to Pages. The source-only fixtures and browser test runners are not in that artifact.

For end-to-end hosted Auth/sync acceptance, create/use a **separate staging Supabase project**. Apply the initial schema and v2 migration there, create the owner privately, disable public signup, and use Settings → Cloud setup to enter that project's URL and publishable key. Test the same account in two devices/contexts, offline edits, expired sign-in and both explicit conflict choices. Changing Cloud setup uses a different account namespace; it does not assign the existing cache to another account.

## What the migration changes

| Area | Change | Existing data |
|---|---|---|
| `workouts` | Add `details jsonb default '{}'`; validate either legacy or version 2 embedded exercises | No historical exercise rewrite, timestamp reset or revision reset |
| `training_documents` | New owner-scoped template/session snapshots, revisions and tombstones; one live session per owner | New table only |
| `training_receipts` | New owner/related-document foreign key and idempotent acknowledgements | Existing `sync_receipts` retained |
| Write RPCs | Legacy-signature `apply_workout` wrapper plus `apply_training_document`; owner-checked private transaction functions | Original operation hash compatibility retained |
| API version | Authenticated `gtrack_api_version()` returns `2` | Preview upload preflight can succeed after migration |
| Security | RLS owner reads, no direct app writes, no anonymous RPC access, private validators | Existing owner restrictions retained |

The transaction rejects malformed ratings, targets, clocks, UUIDs, order and missing nullable fields. A v1 payload cannot overwrite a v2 workout and silently remove its metadata. Public RPC wrappers are `SECURITY INVOKER`; private write functions use an empty search path and check `auth.uid()` explicitly.

## Production release sequence (manual, after approval)

1. Export JSON from every device that might have unsynced work. Finish or explicitly preserve active work, synchronize supported clients, and retain backups. Capture a database backup/snapshot as well. Record existing workout count, IDs and revisions for comparison; do not copy private backups into this repository.
2. Review the SQL and complete the staging owner/two-device smoke test. The initial migration `202611130001_form.sql` is already applied to this project: **do not re-run it** on an existing installation.
3. Close all old application tabs and installed PWA instances before the release. Unsupported v1 clients are prevented from downgrading v2 workout rows, but they cannot understand new templates/sessions.
4. Apply **only** `20261115171330_gtrack_v2_training.sql` to the intended project using its SQL editor or your established linked Supabase migration process. The file wraps the change in a transaction. When using the CLI, inspect `supabase migration list` and `supabase db push --dry-run` first; resolve any initial migration-history mismatch before pushing. Do not use a reset or blindly push the entire migration directory.
5. Verify that authenticated `gtrack_api_version()` returns 2, existing workout IDs/revisions/values are unchanged, and the original RLS/owner checks still pass. Keep public signup disabled. New private schemas must not be added to the Data API's exposed-schema list.
6. Merge the reviewed PR manually into `main`. GitHub Actions installs pinned test dependencies, verifies source/tests, builds 24 local app assets, uploads a Pages artifact and deploys it. Repository Pages source remains **GitHub Actions**.
7. Open `https://ubrubr.github.io/g-track/` online, close/reopen the PWA to activate the new content-hashed service worker, sign in, and verify real existing history before creating new work. Check a new template, one rated set, offline resume, finish, edit and sync on the second device. Confirm local “Saved on device” and cloud “Synced” statuses separately.

New installations apply the original migration first, then the v2 migration, each once, before enabling the v2 client. Create the owner email/password privately in Supabase Auth and disable public signup. Only the project URL and publishable key are frontend configuration.

## Compatibility and recovery

The browser opens the original IndexedDB name at version 2, adding stores without clearing old ones. Pending legacy workout operations keep their IDs and receipts. Templates and sessions use independent operation kinds, revision checks and explicit local/cloud conflict review. Finishing writes completed history, its pending operation and the active tombstone in one transaction; a unique-date failure leaves the active session intact.

Historical data is immutable with respect to template edits. Editing a legacy workout converts a copy to v2, preserving actual values and treating unknown Borg/duration as null. A resumed legacy draft is archived locally before conversion. Export both the new JSON backup and any retained pre-release backups. Version 2 imports both backup versions; the v1 app cannot import v2 files.

Do not drop new columns/tables or purge tombstones/receipts as a quick rollback. That could lose offline work or replay old operations. If the client needs a rollback after v2 records exist, retain the additive database schema, preserve all device backups, and fix forward with a reviewed v2-compatible client. The v1 UI cannot display v2 records correctly. Restore a database snapshot only through an explicit recovery plan that accounts for writes after the snapshot.

One completed workout per calendar date remains the existing rule. If another date record exists, the UI offers its history entry rather than overwriting it. A date collision or cloud revision conflict requires explicit review. Progression acceptance changes planned targets only; dismissals are local UI preferences and are not synchronized or included in JSON backups.
