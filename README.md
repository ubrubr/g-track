# FORM.

A personal fitness log made for portrait use on an iPhone. Semantic HTML, CSS and JavaScript ES modules. **No runtime dependencies, external fonts, analytics, seeded history or CDN imports.** Works as a static GitHub Pages site, including repository subdirectories.

## Start locally

Use Node.js 22 or newer. No installation step is required.

```sh
node scripts/serve.mjs
# http://127.0.0.1:4173/

node scripts/check.mjs
node --test tests/*.test.mjs
node scripts/build.mjs
node scripts/serve.mjs --dist --base g-track --port 4175
# http://127.0.0.1:4175/g-track/
```

Open through HTTP, rather than double-clicking index.html. Add `?dev=1` on a fresh `127.0.0.1` origin to develop without registering the service worker. A previously registered worker still controls that origin: use another port or unregister it in browser developer tools. The production build hashes all assets into its service-worker cache version. `dist/` contains only the app shell; tests, SQL, Git metadata and backups are excluded. The build never reads browser data.

## Supabase setup and owner account

The supplied project URL and **publishable** key are in `config.js`. They are public browser configuration, not administrative credentials. For another project, copy values from `config.example.js` or change Settings → Cloud setup. Leave both values empty for device-only use. Never add secret keys, service-role keys, database passwords or GitHub tokens to this repository.

1. Create a Supabase project, or use your existing project.
2. Apply `supabase/migrations/202611130001_form.sql` in its SQL editor, or through the Supabase CLI migration workflow. Do not reapply an already applied migration. This project's initial migration has been applied during delivery.
3. In **Authentication → Users → Add user → Create new user**, create your owner email/password account. Choose the password privately and enable email confirmation for this manually created account. The application does not create accounts.
4. In **Authentication → Sign In / Providers** (the exact label may vary), turn **Allow new users to sign up** OFF. Keep anonymous sign-in and unused providers disabled. This is a dashboard setting; SQL migrations cannot configure hosted Auth registration. Verify it before use. FORM has no registration form or signup request.
5. Set the Auth Site URL to your Pages URL, for this repository `https://ubrubr.github.io/g-track/`. Password sign-in does not require an OAuth redirect, but keep the project URLs correct.
6. Open FORM → Settings and sign in online. After that, the cached account and its history remain available offline until you explicitly sign out. Sign-in itself needs a connection.
7. If you logged workouts before signing in, choose **Import workouts from device-only mode** in Settings. It previews duplicates and conflicts. Device-only data is not silently assigned to an account.

See [Supabase password Auth](https://supabase.com/docs/guides/auth/passwords) and [RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security).

### Data and access design

`workouts` stores owner, UUID, calendar date, completed exercises and individual sets as one atomic JSON document, deletion tombstone, revision, operation ID and server timestamps. Embedded exercise documents include stable exercise IDs, actual custom names, equipment, notes and the historical repetition convention. There are no independently exposed set rows that could become orphaned or bypass workout ownership.

`sync_receipts` stores idempotency acknowledgements and has a composite foreign key to the same workout owner. Both exposed tables have RLS. Anonymous access and direct authenticated REST writes are revoked; authenticated reads are limited to the owner. Writes use `apply_workout`, which validates every value and explicitly checks `auth.uid()` against ownership. A transaction-scoped owner lock handles concurrent creates and edits. One row per owner/date is enforced by a unique constraint, including tombstones.

The RPC intentionally uses `SECURITY DEFINER` with an empty search path and explicit ownership checks, while ordinary direct writes remain forbidden. Supabase's advisor flags that intentional authenticated RPC capability; the [advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) describes when to revoke it. Two-user access tests verify the intended restriction. No anonymous role can execute this RPC.

Do not purge tombstones or receipts while an offline device may return. Deletion marks the document as deleted, retains its revision, and follows the same queue as a save. Recreating a previously deleted date reuses its UUID and advances the revision after explicit local logging.

## Deploy through GitHub Pages

Target repository: [ubrubr/g-track](https://github.com/ubrubr/g-track).

The workflow at `.github/workflows/pages.yml` runs source validation and the Node test suite, builds `dist/`, uploads the Pages artifact and deploys it on a push to `main`. Pull requests run verification without deployment. All URLs and the service-worker scope are relative, so `/g-track/` works without a router rewrite or custom domain.

In repository **Settings → Pages → Build and deployment**, select **GitHub Actions**. The workflow attempts to enable Pages automatically; if the repository's token cannot enable it, an administrator must select GitHub Actions once and rerun the workflow. The deploy job has only `pages:write` and `id-token:write`; source checkout has `contents:read`.

If transferring the source manually, push this directory's contents as the repository root, with default branch `main`. Never push `dist/`, personal exports, browser database dumps, tokens or backups. `.gitignore` excludes common export and credential paths. For Pages details, see [GitHub's custom workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Install on iPhone

1. Open the deployed HTTPS site in Safari while online.
2. Sign in if you want cloud sync, then let the first app-shell download finish.
3. Tap **Share → Add to Home Screen**, then **Add**.
4. Launch FORM from the Home Screen. It uses standalone display, local icons and safe-area insets.
5. Open once online before relying on offline access. Settings → Install & offline storage shows whether a service worker controls the app.

The manifest includes 192/512 px icons, a maskable icon and an Apple touch icon. Assets are all bundled. The service worker caches only a fixed app-shell allowlist for this repository's scope, never Supabase requests, tokens, backups or personal workout data. Updates wait for the existing app windows to close; reopen after finishing your session to use a new version.

## Logging

One exercise appears at a time in the required order: Squats, Lunges, Step-Up Box, Calf Raises, Romanian Deadlift, Single-Leg Press, Custom Workout, Abs.

The wheels support dragging, mouse-wheel input, tapping a nearby number and keyboard arrows. Home/End go to the bounds; Page Up/Down move ten steps. `js/domain.js` centrally defines the ranges: 1–10 sets, 1–100 reps, 0–300 kg in 0.5 kg steps. Database validation deliberately enforces the same limits; update both if changing them. Each wheel exposes an accessible spinbutton label, bounds and current value. System reduced-motion preferences and the in-app preference are respected.

SETS changes the active set count. REPS and KG edit the selected individual set. Reducing the count hides sets without discarding them inside that draft. Set selectors restore each set's wheels. Apply this set to all copies to active sets. KG means combined external load; 0 means bodyweight. Details records equipment, notes and Total reps / Reps per leg. In per-leg mode, one set includes both legs.

Save & Next validates and marks the current exercise completed, saves the unfinished draft and advances. Previous retains values. Skip excludes the exercise. Finish workout records the completed exercises; Save workout now also completes the current exercise and saves a partial workout. Copy last copies earlier values as suggestions: each exercise must be explicitly saved. Editing uses the same pages, with all previously recorded exercises included until skipped. An existing date must be opened using Edit workout. Newer edits discovered after opening a draft require an explicit version choice.

Dates are `YYYY-MM-DD` calendar strings. Date display and chart arithmetic never parse them as local midnight or convert them to another calendar day.

## Offline storage and synchronization

IndexedDB stores workouts, drafts, settings, pending operations and the cached login session. Account data is namespaced by Supabase project plus authenticated user UUID. Sign-out hides that cache, keeps its pending work, and opens the separate device-only cache. As with any locally cached private app, use a trusted, locked device.

Final local data and its pending operation are committed in the same IndexedDB transaction. Draft removal belongs to that transaction. No server request is necessary to finish a workout. If local storage fails, the app reports the failure rather than claiming a save succeeded.

Sync runs after finalized saves/imports/deletions, on app opening, return to the foreground, regained connectivity, and Sync now. Visible app failures retry with backoff. The design does not rely on iOS background execution. Each queued change retains its operation UUID until server acknowledgement; a receipt makes retries after a lost response idempotent. A new edit made during an upload survives the acknowledgement and is rebased onto the confirmed revision.

The header distinguishes **Saved on device**, **Sync pending**, **Synced**, **Sync failed** and **Sign in to sync**. Synced requires server confirmation. Expired authentication and connection failures retain pending data. Settings shows conflicts with both versions, their sets and any deletion. Keep this device submits a new revision-based edit; Use cloud replaces the local version only after that explicit choice. A later concurrent change can require another review.

History expands to individual sets, equipment, convention and notes. Delete asks for confirmation. Progress has exercise, equipment, time-range and metric filters. Each custom exercise has its own stable ID and series. Volume sums repetitions × weight; per-leg sets double both total repetitions and volume. Bodyweight progress defaults to repetitions without estimating body mass. Missing, skipped and unvisited results do not become zero-performance points. Point buttons reveal the underlying sets and date. Charts read local records offline.

iOS may evict website data and does not guarantee durable storage. Keep JSON backups; cloud sync and a Home Screen installation do not replace them. Changing hostname, browser profile, clearing site data or signing out changes which local cache is accessible.

## Backup and restoration

In Settings, export a **JSON backup** or **CSV**. JSON schema version 1 includes all workout documents, sets, custom exercise names, equipment, notes, historical conventions, settings and the unfinished draft; tombstones are included. It excludes authentication tokens and administrative credentials. CSV has one completed set per row, including entered reps, total reps and volume.

Restore JSON backup validates the entire file (maximum 10 MB) before writing. It rejects invalid ranges, IDs, dates, duplicate IDs/dates, inconsistent exercise names and unsupported versions. Identical records are skipped. Conflicting dates/IDs require a visible choice to keep existing data or use the backup version. A checkbox explicitly controls replacement of an unfinished draft. Settings restore with the backup. Imports write in one IndexedDB transaction and enter the normal sync queue, using current local/server revisions rather than trusting revision values in a file.

To move to a new device, sign in and sync first, then import your JSON if needed. Review conflicts carefully: restoring an older backup over newer cloud data is an explicit edit, not an automatic reset of the cloud history. Keep exports outside the repository.

## Verification

See `VERIFICATION.md` for performed checks and remaining device/account checks. Run the Node suite with the commands above. To run the native browser storage suite, serve the source and open `tests/browser.html` on a **fresh localhost port**, then click Run browser checks. It uses real IndexedDB with isolated disposable database names and a fault-injected in-memory server, not your account. Tests are excluded from deployment.

`supabase/security-tests.sql` creates disposable Auth rows inside a transaction, impersonates two authenticated JWT subjects, checks RPC idempotency, conflicting revisions, tombstones, read/write isolation and anonymous RPC denial, then rolls everything back. Run it only after inspecting it and after applying the schema. It does not leave test history or accounts behind.

## Source map

- `js/domain.js`: exercise catalogue, limits, dates, draft transitions, validation and metrics.
- `js/db.js`: account-scoped IndexedDB and atomic local write/queue operations.
- `js/cloud.js`: dependency-free Supabase Auth REST client, refresh and database RPC transport.
- `js/sync.js`: explicit synchronization orchestration.
- `js/wheel.js`: accessible independent number wheels.
- `js/backup.js`: versioned backup validation/import planning and CSV.
- `js/app.js`, `styles.css`, `index.html`: interface and workflows.
- `service-worker.js`, `manifest.webmanifest`, `icons/`: installable offline app shell.
- `supabase/`: migration and access verification.
- `scripts/`: dependency-free preview, icon generation, checks and static build.
