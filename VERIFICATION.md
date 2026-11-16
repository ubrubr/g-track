# Final workflow verification

Executed 16 November 2026. Fixtures are synthetic and isolated. No owner credentials were entered and no v2/v3 production migration was applied. This supersedes the previous design's verification.

## Executed checks

- **123/123 Node tests passed**, Node 24.22.1: retained 78 regressions, 33 automatic-workflow/repository tests, 10 new SQL tests and 2 additional HTTP compatibility cases.
- **20/20 native browser regressions passed**, including real IndexedDB transactions and retry/conflict/import fault cases.
- **15/15 final native UI groups passed**. Responsive checks cover 25 combinations: Routines, Active, RPE, History and Profile at 320, 375, 390, 430 and 1280 px; height 700 at 320 px and 844 otherwise.
- `node scripts/check.mjs` passed: syntax, relative paths, manifest/icons and offline asset coverage.
- `node scripts/build.mjs` passed: 41 app assets/content-hashed cache, excluding fixtures, SQL, dependencies and private backups.

## Functional coverage

| Area | Executed evidence |
|---|---|
| Routines | Native create, rename, duplicate, arrange/delete, library/custom IDs and different set targets; immutable snapshots |
| Active design | Supplied SVGs, black background, one exercise, current working load, exactly three panels and four nav items; no fake phone chrome |
| Timing | Automatic first/next activation; final checkbox/navigation/finish stop; rests included; Back pauses; resume excludes pause; sheets/History/Profile/reload retain timing |
| Completion/RPE | Actuals saved before RPE; every value 6–20, null Skip, no initial choice, selection survives reload, duplicate events idempotent, recorded RPE edit leaves rest unchanged |
| Changes | Actual edits, uncheck, add/remove sets, rest edit/reset/skip, exercise selection, multiple resumable routine drafts |
| Finish | Direct save/return without dialog/toast/recap; original targets, actuals/unfinished flags retained, zero-completion workout valid |
| Progression | Latest matching ID/variation/convention completed volume, planned/current deltas, per-leg factor, missing/zero distinction, separate deliberate routine update |
| History | Weight/reps/volume charts, clickable exact set details, Borg/exercise time, corrections without live clocks/rest/RPE |
| Profile | Preferences persist; repetitions-only edits in lb retain exact kg; owner namespaces and JSON/import/CSV |
| Compatibility | Real v1/v2 IndexedDB upgrades preserve history/drafts/settings/Auth/pending IDs; old single session copied; missing plans/time stay unknown |
| Synchronization | Offline queue/reopen, lost acknowledgement UUID retry without duplicates, in-flight rebasing, stale rejection and explicit conflict resolution |

## Database and HTTP

PGlite executes all three actual migrations in isolated PostgreSQL. It verifies unchanged legacy rows/revisions/timestamps, prior security regressions, v3 profile/routine/session/workout round trips, decimal weights, multiple same-date history/drafts, automatic clocks, pending Borg, validation rollback, receipts/CAS, downgrade rejection, owner RLS/private-invoker privileges, no anonymous/direct writes and cross-owner related-record rejection.

Cloud tests inspect v2/v3 HTTP serialization including profile preference, pending Borg selection, completion flags/clocks and details; cache metadata is excluded. Backend 1/2 remains readable but cannot receive new writes. Mocked Auth expiry/refresh failures preserve queued work. These local tests do not constitute hosted PostgREST/Auth acceptance.

## Visual and offline evidence

The supplied `mobile UI.pdf` was rendered and inspected: approved active layout on page 1, remaining pages blank. Twelve supplied SVGs are reused unchanged. CSS safe areas replace the reference's fake device/status chrome. [Working screenshots](docs/PREVIEW.md) contain no personal production history.

The built `/g-track/` shell is loaded/cached, then its HTTP server is stopped. It reloads through the service worker, records a rated set, finishes directly and reloads persisted History with server still stopped. [Offline evidence](docs/final-previews/09-offline.jpg). This tests shell/storage, not offline hosted login.

## Remaining acceptance

Supabase automatic approval review rejected production SQL preflight because workspace credits were exhausted. No new production backup/fingerprint or v2/v3 migration completed. Restore credits, refresh schema inspection, take private backups, complete staging owner/two-device acceptance, apply reviewed migrations, verify preservation and deploy. [Release procedure](docs/UPGRADING.md).

Physical iPhone Safari/installed-PWA acceptance remains for actual safe areas, virtual keyboard, lock-screen interruption and platform behavior. Timestamp recovery is tested; callback delivery while suspended is not guaranteed. Regular JSON backups cover browser storage eviction.
