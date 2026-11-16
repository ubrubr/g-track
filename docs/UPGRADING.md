# Releasing the final routine workflow

## Release state

The final client release is tracked in [PR #4](https://github.com/ubrubr/g-track/pull/4), based on `main` commit `d51b3e8`. The existing GitHub Actions workflow publishes reviewed main to `https://ubrubr.github.io/g-track/`.

On 16 November 2026 the automatic-review credit failure was resolved, the established connector was retried, and both additive migrations were installed. Hosted history is initial `form_atomic_workouts` (`20261113201213`), `gtrack_v2_training` (`20261116173257`) and `automatic_routine_workouts` (`20261116174423`). The hosted timestamps differ from source filenames because the connector records application time; match these migrations by name/content before any CLI push. API version is 3.

A private app-data/schema export and fingerprints were captured before migration under ignored `backups/`. Existing workouts, receipts, Auth users and identities matched after upgrade. Hosted RPC/owner tests passed inside a rolled-back transaction, leaving no synthetic records. Protected REST endpoints deny anonymous access, and signup remains disabled. [Verification details](../VERIFICATION.md).

## Preview and staging

Serve the source and open `/tests/preview.html`. Its signed-out synthetic fixtures use localhost-only `gtrack-qa-*` databases. Production ignores the database override and excludes fixtures. PR Actions provide a `g-track-preview` artifact; extract and serve it over HTTP.

For hosted acceptance, use a separate staging Supabase project with the full migration chain, a privately created owner account and signup disabled. Enter only its URL/publishable key in Profile → Connection. Test two independent contexts/devices: sign-in, routine/profile edits, multiple drafts and same-date workouts, pending Borg reload, pause/resume, offline changes, foreground sync, Auth refresh, historical correction and both conflict choices. Keep credentials/private backups outside Git.

## Schema changes

| Migration | Change | Preservation |
|---|---|---|
| `20261115171330_gtrack_v2_training.sql` | Versioned workout details, routine/session documents and receipts; owner-checked private writes/public invoker wrappers | Initial rows, revisions, timestamps and receipts retained |
| `20261116145425_automatic_routine_workouts.sql` | API 3, profile documents, multiple drafts/workouts per date, automatic exercise clocks, pending Borg selection and plan/actual validators | Old validators retained; existing exercise JSON is not rewritten |

Internal cloud kind `template` stays for compatibility; all product UI calls it **Routine**. Profiles bind to the Auth user ID. Related routines, profile ordering and baseline-workout references must share ownership. Validators reject malformed clocks, duplicated IDs and invalid ratings. Older clients cannot downgrade version 3 records.

Workouts, documents and receipts keep owner-read RLS. Direct app writes and anonymous write RPC access are revoked. Private functions check `auth.uid()` with an empty search path. Keep the private schema outside exposed Data API schemas. Retain tombstones and receipts while an offline device may return.

## Production sequence

1. Inspect current hosted migration history/schema before acting. The migrations above are already installed on the configured production project.
2. Export JSON from every device with possible unsynchronized work, retain old backups and obtain a private database snapshot/export. Record existing workout IDs, revisions, timestamps, counts and content fingerprints.
3. Run regression and transactional RPC/owner smoke tests; use a separate staging project where available for private owner/two-device acceptance. Close old production tabs/PWAs before cutover; earlier clients cannot display new records correctly.
4. Apply only missing reviewed migrations in order. Original `202611130001_form.sql` corresponds to the installed initial schema with a different hosted history timestamp. **Do not rerun it**, reset the database or blindly push the directory. For the established CLI workflow, inspect `supabase migration list` and `supabase db push --dry-run` and resolve that mapping first. Both additive files are transactional.
5. Verify authenticated `gtrack_api_version()` returns **3**, constraints/validators/owner privileges hold, and pre-existing workout values/revisions/timestamps match the baseline. Preserve Auth users and signup settings.
6. Merge the final reviewed PR into `main`. Existing Actions checks/builds 41 assets and deploys only main; Pages source remains **GitHub Actions**.
7. Open Pages online and close/reopen the PWA to activate the waiting worker. Sign in and inspect existing history. Check a routine, rated set, pause/resume, offline reload, finish, second same-date workout, correction and second-device sync. Status/recovery stays in Profile.

New installations apply initial schema then both additive migrations once, create the owner privately and disable signup. Only URL/publishable key go into frontend configuration.

## Recovery

IndexedDB 3 keeps the original database/stores and pending operation UUIDs/Auth metadata, copies the single active session and adds profiles/multiple drafts. Legacy drafts are archived before resuming. Missing historic plans/exercise time remain unknown; preserved legacy per-set time is exported.

Version 3 JSON supports multiple same-date workouts/drafts; earlier clients cannot restore all its content. Preserve old backups and export a new backup after upgrade.

After version 3 writes, retain the additive schema/backups and fix forward with a compatible client. Do not drop new tables/stores or purge receipts as a quick rollback. Snapshot restoration requires an explicit recovery plan accounting for later writes.
