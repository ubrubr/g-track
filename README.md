# G-Track

A private fitness PWA built with HTML, CSS and JavaScript. The final design reuses the supplied icons with black, grey and cyan styling. Navigation is **Routines / Workouts / History / Profile**. There are no runtime packages, CDN assets, analytics or seeded production workouts.

Repository: [ubrubr/g-track](https://github.com/ubrubr/g-track). Production URL: [ubrubr.github.io/g-track](https://ubrubr.github.io/g-track/). The final client release is tracked in [PR #4](https://github.com/ubrubr/g-track/pull/4). Both additive backend migrations were installed and verified on 16 November 2026; the configured project reports API version 3. [Release instructions](docs/UPGRADING.md).

## Run and review

Use Node.js 22 or newer. Running the app needs no package installation:

```sh
node scripts/serve.mjs --port 4173
```

Open `http://127.0.0.1:4173/?dev=1`. On localhost, development mode skips service-worker registration. A fresh port avoids an earlier service worker.

For synthetic, signed-out previews, open `http://127.0.0.1:4173/tests/preview.html`, choose a screen, then **Open isolated preview**. Every launch uses a separate local database and never uploads data. Fixtures are excluded from production. [Screen gallery](docs/PREVIEW.md) · [Verification evidence](VERIFICATION.md).

## Training workflow

1. Create a routine, add library/custom exercises, arrange them, and set individual weights, repetitions and rest. Romanian Deadlift is included; default rest is 180 seconds.
2. Start a workout. Its plan is an independent snapshot. Only the current exercise appears, and whole-exercise timing starts automatically in the background.
3. Check **DONE**. Actual values and completion time save immediately. Choose Borg RPE 6–20 or Skip; rest then starts automatically. Disabling RPE in Profile starts rest immediately.
4. Edit actuals, add/remove sets, correct checkboxes, change/reset/skip rest, or select another exercise. Editing recorded RPE leaves rest unchanged.
5. Back saves and explicitly pauses the draft. Resume excludes the paused period. History, Profile, sheets and backgrounding leave timing running. Switching routines preserves separate resumable drafts.
6. Finish saves directly and returns to Routines. History retains the plan, actuals, unfinished flags and exercise durations. Multiple workouts on one date are supported.

The active screen contains no manual set timer, visible exercise clock, previous-result text, sync banner, confirmation, success toast or recap. The load beneath the title is the selected set's working load.

## Plans and progression

Both panels compare volume: `sum(weight × repetitions)`. Per-leg repetitions count both legs. The baseline is completed actual volume from the most recent finished workout with the same stable exercise ID, variation and repetition convention, across routines. Names may change without breaking identity; different custom exercises remain separate.

Planned progression is planned volume minus baseline; current progression is completed volume minus the same baseline. Negative values are neutral. No comparable baseline displays “—”; recorded zero remains zero.

Open Planned progression to inspect the prior result and deliberately edit this workout's targets. Completed actuals stay intact. **Update routine plan** is a separate action. Actual edits never alter targets. Routine changes never rewrite active or historical snapshots.

History compares planned/completed weight (peak set load), total repetitions and volume. Points open exact set values, Borg ratings, whole-exercise time and recorded progression. Missing plans/results/timing remain “—”. Historical correction starts no live clock, rest or RPE prompt.

## Profile and configuration

Profile holds display name, kg/lb preference, default rest and RPE preference, plus sign-in, discreet synchronization/recovery and backup. Weights are stored in kg to six decimal places. Changing units or only editing repetitions does not drift stored weights.

Existing Supabase URL and **publishable** key remain in `config.js`. Never put a secret/service-role key or database password in frontend files. Existing email/password authentication, persistent sessions and account namespaces remain. There is no signup form; keep public signup disabled. Profile → Connection can select a separate staging project without reassigning cached data between accounts.

Cloud API version 3 is required for writes. Version 1/2 backends can still supply compatible history/documents while new work stays queued. Failed connections and expired authentication preserve the queue. Owner RLS, revision checks, private owner-checked write transactions and idempotent receipts protect cloud data. Profile provides explicit local/cloud conflict choices.

## Storage and backup

The original IndexedDB name `form-fitness-v1` is retained at version 3. Upgrade preserves old stores, workouts, settings, Auth metadata, legacy drafts and pending operation IDs. It adds profiles/multiple workout drafts, copies the old single session and removes the unique calendar-date index. Resuming a legacy draft archives its original first. Previously unrecorded whole-exercise duration remains unknown; new automatic timing starts on resume.

Profile → **JSON backup** exports routines, completed workouts, all unfinished drafts, pending RPE selection, timing/rest state, preferences and retained legacy drafts. It excludes Auth tokens. Import accepts FORM v1 and G-Track v2/v3, previews duplicates/conflicts, and restores drafts/profile only when selected. Different IDs on one date are valid. Moving device-only data into an account requires deliberate import.

**CSV export** contains completed actual set rows, known targets, Borg, legacy set time, whole-exercise time and progression. Missing plans/times remain empty. JSON is the restore format. Keep private backups outside Git; browser storage can be evicted, so export regularly and sync when online.

## Check and build

Pinned `fake-indexeddb` and PGlite packages are development-only:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run build
node scripts/serve.mjs --dist --base g-track --port 4175
```

Open `http://127.0.0.1:4175/g-track/`. The build has 41 local app assets and a content-hashed service worker. It excludes fixtures, SQL, screenshots, dependencies and private backups. Relative asset paths/manifest scope support the existing Pages subdirectory. Offline access works after the first successful load.

Source browser runners: `/tests/browser.html` (20 regressions) and `/tests/training-browser.html` (15 end-to-end groups including 25 responsive screen combinations). They use disposable databases without a live account. PR Actions verify source/tests/build and upload a preview artifact; deployment is guarded to `main`.

## Deployment and acceptance

Migration chain: initial schema → `20261115171330_gtrack_v2_training.sql` → `20261116145425_automatic_routine_workouts.sql`. Do not rerun the initial schema on an existing installation. Inspect migration history, take private backups, apply only missing migrations, verify unchanged existing rows and API version 3, then deploy the reviewed client. [Detailed procedure and rollback](docs/UPGRADING.md).

The production upgrade preserved existing workout, receipt, Auth-user and identity fingerprints. Hosted transactional RPC tests passed and were rolled back; anonymous REST access is denied and public signup remains disabled. Private owner sign-in/two-device UI acceptance and physical iPhone Safari/installed-PWA checks remain for actual safe areas, keyboard and lock-screen behavior. Timestamp recovery is tested; browsers cannot guarantee callback delivery while locked. See [checks actually executed](VERIFICATION.md).
