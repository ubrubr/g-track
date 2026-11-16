# Releasing the final routine workflow

## State at handoff

Branch `codex/final-routines-design` starts from `main` commit `d51b3e8` (earlier PR #3 was already merged). Pages remains `https://ubrubr.github.io/g-track/`. This final-design branch has not replaced production.

Hosted migration history last reported only initial `form_atomic_workouts` (`20261113201213`). Neither new migration was applied during this work. Supabase SQL preflight was rejected by **automatic approval review because workspace credits were exhausted**. It was not executed; this was not a determination that the SQL was unsafe. Do not bypass that check with another SQL client. Refill credits, then resume the established connector.

No new production database backup or full row fingerprint was captured. Obtain them before changing the hosted schema. Local PostgreSQL tests are not a production backup or hosted acceptance.

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

1. Resolve the automatic-review credit failure. Inspect current hosted migration history/schema again before acting.
2. Export JSON from every device with possible unsynchronized work, retain old backups and obtain a private database snapshot/export. Record existing workout IDs, revisions, timestamps, counts and content fingerprints.
3. Complete staging owner/two-device smoke tests. Close old production tabs/PWAs before cutover; earlier clients cannot display new records correctly.
4. Apply only missing reviewed migrations in order. Original `202611130001_form.sql` corresponds to the installed initial schema with a different hosted history timestamp. **Do not rerun it**, reset the database or blindly push the directory. For the established CLI workflow, inspect `supabase migration list` and `supabase db push --dry-run` and resolve that mapping first. Both additive files are transactional.
5. Verify authenticated `gtrack_api_version()` returns **3**, constraints/validators/owner privileges hold, and pre-existing workout values/revisions/timestamps match the baseline. Preserve Auth users and signup settings.
6. Merge the final reviewed PR into `main`. Existing Actions checks/builds 41 assets and deploys only main; Pages source remains **GitHub Actions**.
7. Open Pages online and close/reopen the PWA to activate the waiting worker. Sign in and inspect existing history. Check a routine, rated set, pause/resume, offline reload, finish, second same-date workout, correction and second-device sync. Status/recovery stays in Profile.

New installations apply initial schema then both additive migrations once, create the owner privately and disable signup. Only URL/publishable key go into frontend configuration.

## Recovery

IndexedDB 3 keeps the original database/stores and pending operation UUIDs/Auth metadata, copies the single active session and adds profiles/multiple drafts. Legacy drafts are archived before resuming. Missing historic plans/exercise time remain unknown; preserved legacy per-set time is exported.

Version 3 JSON supports multiple same-date workouts/drafts; earlier clients cannot restore all its content. Preserve old backups and export a new backup after upgrade.

After version 3 writes, retain the additive schema/backups and fix forward with a compatible client. Do not drop new tables/stores or purge receipts as a quick rollback. Snapshot restoration requires an explicit recovery plan accounting for later writes.
