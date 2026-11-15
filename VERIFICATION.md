# G-Track 2.0 verification

Executed on 15 November 2026. The original production application and hosted schema were not replaced. Browser tests and screenshots use synthetic data on localhost; PostgreSQL tests run in an isolated PGlite instance with test Auth claims.

## Executed automated checks

- **78/78 Node tests passed** using Node 24.22.1. This includes all 15 original tests, 31 training/analysis/backup model tests, 13 IndexedDB repository tests, 6 HTTP/Auth/sync fault tests and 13 PostgreSQL migration/RPC/RLS tests.
- **20/20 original native browser checks passed**, updated only to recognize the redesigned entry screen and isolate responsive fixture storage. Real browser IndexedDB, transactions, fault injection, retries, conflicts, import and the retained legacy wheel regression are exercised.
- **10/10 new native browser checks passed** against the real application. They cover the sequential flow, custom exercise/reordering/targets, timers, all Borg values, reload, rest, add/skip/restore, finish and edit, analysis/detail/history links, template CRUD/cancel, progression accept/dismiss, and responsive layout.
- `node scripts/check.mjs` passed: all JavaScript syntax, relative paths, PWA manifest, icons and offline asset coverage.
- `node scripts/build.mjs` passed: **24 application assets** with a content-hashed service worker. No test fixtures, dependencies, SQL or personal data are included.
- Built `/g-track/` PWA was loaded and cached on port 4182, then its HTTP server was stopped. It reloaded from the service worker, completed a set with Borg 13, saved only completed work and reloaded the persisted summary with the server still stopped. [Offline evidence](docs/previews/offline-verification.jpg). This verifies shell/storage behavior without a server, not offline hosted authentication.
- Browser UI matrix: Home, Active, Borg and Analysis at **320, 375, 390, 430 and 1280 px**, 844 px frame height. No page horizontal overflow; primary finish control at least 60 px high, within the viewport and above navigation; all Borg choices at least 44 px wide. Exercise order has named move buttons; set controls, dialog/radio states and chart points have accessible names.

## Requested functional coverage

| Requested area | Executed evidence |
|---|---|
| 1–2. Create/edit templates | Native UI through configuration and Save; repository template CRUD without history |
| 3–4. Add/remove/reorder exercises | Native library/custom creation, remove control and accessible move; >8 exercises model validation |
| 5–6. Individual targets and rest | Native edits and stored repository assertions; JSON/SQL round trips |
| 7–8. Start/resume | Native start and reload; DB unique-active guard and persisted prompt/timestamps |
| 9–10. Stopwatch and recovery | Native Start/Pause/Reset/Stop, running reload; deterministic timestamp interruption tests |
| 11–12. Set completion/Borg prompt | Native Stop and Done flows; token prevents duplicate completion; set remains pending until rating/skip |
| 13–16. Borg 6–20, rejection, null, editing | Every value tapped through the actual UI; direct 20; no initial choice; model/SQL invalid-value rejection; native skipped-null and history edits |
| 17. Rest countdown | Native Pause/Resume/+30/Skip; deterministic expiry/recovery; no automatic next-set completion |
| 18–19. Add sets/skip exercises | Native controls and completed-work confirmation/restore; completed values preserved |
| 20–23. Finish/volume/mean Borg/duration | Native completed-only confirmation, summary and edit recalculation; per-leg, partial, missing-data and timestamps unit tests |
| 24. Comparable history | Prior comparable recorded date, variation/template separation, prior outside visible range, zero baseline and cautious exertion tests |
| 25–26. Interactive charts/history | Native point → recorded-set detail → matching expanded History; metric/date/exercise filters |
| 27. Offline storage | Native IndexedDB transactions and restart/reload, cached history/pending queues, unique-date rollback; service-worker check described below |
| 28. Supabase synchronization | HTTP serialization/Auth refresh mocks, network/lost-ack/conflict tests, real isolated SQL RPC and two-owner RLS tests; no claim of hosted v2 acceptance |
| 29. Migration compatibility | Version 1 DB upgrade without clearing stores; legacy draft/workout/backup reads and edits; original SQL security suite after v2; no v2 downgrade |
| 30. Responsive/accessibility | 20-layout native matrix, semantic named buttons/radios, keyboard Borg controls, reduced-motion CSS and fixed-footer bounds |

## Database and sync evidence

The SQL suite applies the actual original migration, creates legacy fixtures, then applies the actual new migration. It verifies unchanged legacy values/revisions/timestamps; the original two-user security SQL; target/order/rest/custom identity round trips; all workout timing/Borg/name metadata; explicit nullable fields; validation rollback without a receipt; no duplicate set IDs; active clocks/prompt; one active session and tombstone reuse; idempotent operation receipts; revision conflict responses; owner RLS, related-owner foreign keys and RPC checks; restricted direct writes/private validators; and rejection of old-client downgrade.

The repository suite opens a genuine v1-shaped database using fake-indexeddb, upgrades it with the real application code and checks history/draft/settings/auth/queue preservation. It verifies atomic finish, duplicate-date rollback, owner isolation, retry acknowledgements, edits while uploads are in flight, finishing an old session before a new one starts, explicit stale/conflict choices, imports, and reopening finished history without letting a stale tab resurrect it.

Cloud tests inspect actual serialized HTTP payloads and simulate expired-token refresh, failed refresh and schema-upgrade fallback failure. They prove new fields are retained and a v1 production backend cannot receive uploads from this preview.

## Browser and visual evidence

The native suites are reproducible at `/tests/browser.html` and `/tests/training-browser.html` through the source server. Disposable databases have unique names and no live account. The 10 training checks are end-to-end groups rather than superficial one-function assertions; a failure can cascade to later groups, so the final complete run must be green.

Nine requested screens were inspected in a mobile viewport and captured in [the screenshot gallery](docs/PREVIEW.md), with an additional desktop dashboard. The written four-stage structure and exact supplied palette guided implementation; only the text attachment was available, not the two referenced images. Screenshots contain clearly synthetic sessions and show real persisted controls and calculations.

## Acceptance limits

- No v2 migration or writes were made to hosted production as part of this PR. Real hosted v2 owner sign-in, two-device sync and Auth expiry must be accepted against staging after migration, then smoke-tested on release. Isolated SQL is real PostgreSQL execution, but the test `auth.uid()` adapter is not a hosted Auth service or PostgREST instance.
- The browser checks run in the desktop app's Chromium environment. A physical iPhone Safari/installed-PWA check remains for keyboard positioning, safe areas, locked-screen interruption and platform-specific sound/haptics. Timers use persisted timestamps; callback/alarm delivery during suspension is not guaranteed by browsers.
- The progression rule is deliberately conservative and requires complete Borg evidence. It is an explicit suggestion, not a physiological model or conversion to repetitions in reserve.
- One completed workout/date and the existing load/repetition bounds remain. JSON backups are required for recovery from storage eviction; optional sound/vibration never determines correct completion.
