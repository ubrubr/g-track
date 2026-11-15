# G-Track 2.0

A personal, offline-first training log for iPhone portrait, tablet and desktop. Plain HTML5, CSS and JavaScript modules, with **no runtime packages, CDN assets, analytics or seeded production history**. Supabase provides owner authentication and versioned cloud synchronization; GitHub Pages hosts the static app.

This redesign is a review branch. Production is not replaced by the PR. The proposed SQL migration is **not applied to production**.

## Preview before merging

Check out `codex/g-track-2-redesign`, then use Node.js 22 or newer:

```sh
node scripts/serve.mjs --port 4173
```

Open **http://127.0.0.1:4173/?dev=1**. No npm installation is needed to run the app. Use a fresh port if an older service worker controls that origin. Development mode skips service-worker registration only on localhost.

For an isolated preview with synthetic sessions, open **http://127.0.0.1:4173/tests/preview.html**. Choose a screen and open it. From Home, select Leg Day to configure it, then Save Workout to see Start. These fixtures use uniquely named `gtrack-qa-*` databases, remain signed out, and never upload to Supabase. Fixtures and tests are excluded from `dist/`.

The PR's Actions run uploads a `g-track-preview` artifact. Download and extract it, then serve the extracted folder over HTTP, for example `npx --yes http-server . -a 127.0.0.1 -p 4174`. Do not open `index.html` as a file. [Screen gallery](docs/PREVIEW.md) · [verification evidence](VERIFICATION.md) · [migration and deployment](docs/UPGRADING.md).

## Training workflow

1. **Set up your gym day:** create, select, duplicate, rename or delete saved templates; resume an unfinished session first.
2. **Configure:** use the preserved exercise library or create an exercise, reorder it, edit individual targets and set exercise-specific rest. Save creates a template, never completed history.
3. **Start:** review planned exercises, sets and an estimate, then create a separately persisted active snapshot.
4. **Train:** edit actual values in compact set rows; use contextual Start/Pause/Stop/Reset controls. Stop or Done opens Borg; confirm or skip it before the set is completed and rest begins. Add sets, skip/restore exercises and finish only completed work.
5. **Review:** see actual totals and comparable history, edit past sets, or open interactive volume, weight, repetitions, Borg and duration charts.

The dark palette uses outlined cards and neutral navigation. The primary green is reserved for primary actions and completion. Borg has its own blue/green/orange/red intensity scale, with all 15 original values (6–20), descriptions, keyboard controls and no initial selection. Missing ratings and times remain null.

## Calculations and suggestions

- Volume is the sum of **completed, unskipped actual weight × repetitions**. Per-leg exercises count both legs. Bodyweight is stored as 0 kg of external load; no body-mass estimate is added.
- Planned duration assumes **30 seconds per set plus configured rest between sets**, including exercise transitions. It is an estimate, not measured rest or a completion promise.
- Overall duration uses the session start/end timestamps. Set stopwatch time uses accumulated milliseconds plus a running timestamp. Rest has an independent deadline/paused remainder. Timers recover after suspension or reload; intervals only refresh the display.
- Borg averages exclude missing ratings. Exercise-filtered duration uses recorded set time; whole-workout duration uses the recorded session duration. Missing legacy time displays “—”.
- Comparisons use the previous recorded session with the same template and exercise identities, variations and repetition conventions, including prior sessions outside the displayed date window. They never assume yesterday was a training day. Zero baselines have no percentage.
- Progression requires two comparable v2 sessions, every planned set and rep achieved at the current load, every set rated, mean Borg ≤15 and non-rising, and a common positive target load. The suggested increase is 2.5% rounded down to 0.5 kg, bounded to 0.5–2.5 kg, rejected if over 5% or the 300 kg limit. This is a conservative heuristic, not an RIR estimate. **Acceptance is explicit** and changes only relevant planned values. Dismissal is device/account-specific and lasts until the source session pair changes. Accepted source IDs prevent repeated increases from the same evidence.

## Storage and compatibility

`js/model.js` owns versioned training documents; `training-db.js` extends the working IndexedDB repository; `cloud.js`/`sync.js` retain Auth, retries, owner isolation, receipts and explicit conflicts. Rendering, editors, settings and analytics are separate small modules.

The existing `form-fitness-v1` IndexedDB name is intentionally retained and upgraded to version 2. Old stores, Auth metadata, drafts, history, settings and pending operations remain. New template/session stores are additive. A template and a completed workout are different documents. Active and completed exercises are snapshots, so later template changes cannot rewrite history.

Legacy JSON and backups remain valid. An old workout is converted to the v2 shape only when edited; missing Borg and timing stay unknown. Resuming an old draft archives its original content, preserves values and completion, and labels new elapsed time as “since resume.” JSON backups include history, templates, active clocks, pending Borg state, settings and legacy drafts. Imports preview duplicates/conflicts and require explicit restoration of an active session. CSV adds planned targets, actual timing, Borg and workout identity without exporting unfinished/skipped work.

Cloud schema preflight blocks uploads from this preview until the reviewed v2 migration exists. Legacy history can still be read, while all local changes remain queued. After migration, versioned workout metadata and training documents round-trip without dropping new fields. See [UPGRADING](docs/UPGRADING.md) before connecting a reviewed build to a production account.

The existing **one workout per owner/calendar date** rule remains. Templates allow 1–50 exercises, 1–30 sets each, 1–100 reps, 0–300 kg in 0.5 kg steps and 0–3600 seconds of target rest. Only one active session per owner is permitted.

## Verify and build

The two pinned packages are development-only: `fake-indexeddb` for repository tests and PGlite for isolated real PostgreSQL migration/RLS/RPC tests.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run build
node scripts/serve.mjs --dist --base g-track --port 4175
# http://127.0.0.1:4175/g-track/
```

For native browser tests, serve the source and open `/tests/browser.html` (20 regression checks) and `/tests/training-browser.html` (10 complete UI checks, including a 20-layout responsive matrix). Each has a Run button. Test databases are disposable and use no live account.

The content hash versions the offline shell. `dist/` contains only the app and icons; it excludes SQL, tests, fixtures, screenshots, dependencies, Git metadata and personal backups. The build never reads browser storage.

## Auth, security and deployment

The existing Supabase project and public publishable key stay in `config.js`. They are browser configuration, not privileged credentials. No service-role key or database password belongs in the frontend. Owner sign-in stays email/password, with no registration form. Keep hosted public/anonymous signup disabled. Device-only training stays in its own namespace until an explicit import.

Workouts, training documents and receipts retain owner-based RLS. Direct authenticated table writes and anonymous RPC execution are revoked. Public invoker wrappers call non-exposed, owner-checked private transaction functions for revision checks and idempotency. Related receipts cannot cross owners. Tombstones and receipts must remain while an offline device may return.

The workflow verifies PRs and uploads a preview artifact. Deployment is guarded to **main only**, with Pages write permission confined to the deployment job. After review, backup, migration and owner smoke testing, merge manually to publish on the existing Pages URL. Full steps and rollback precautions are in [UPGRADING](docs/UPGRADING.md).

## Practical limits

Physical iPhone Safari/PWA safe-area, lock-screen and audio/haptic testing remains a device acceptance step. Timestamp recovery is tested, but browsers may suspend callbacks and cannot guarantee an alarm while locked. Sound requires prior interaction; vibration is optional and unsupported on some devices. Visual rest completion always works when the app resumes. No push-notification permission is requested.

Browser storage can be evicted. Use JSON backups, request durable storage in Settings where available, and sync when online. Full hosted v2 synchronization must be smoke-tested in a staging Supabase project after applying the migration; this PR uses mocked HTTP fault tests and isolated PostgreSQL tests and leaves production unchanged. The two referenced image attachments were unavailable; the implementation follows the detailed written wireframe and Borg specification.
