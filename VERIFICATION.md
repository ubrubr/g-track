# Delivery verification

## Performed

- Source syntax, offline asset coverage, manifest, icon files, relative URLs and static build passed.
- **15 Node tests passed**: exact exercise ordering, set reservoir preservation, partial inclusion, custom identity separation, copy/edit semantics, complete draft serialization, per-leg calculations, missing/deleted chart exclusion, range/date validation, month-end chart boundaries, backup round trips, duplicate/conflict planning and CSV escaping/formula protection.
- Calendar date/display checks passed in Europe/Budapest, America/New_York, Pacific/Honolulu and Pacific/Kiritimati, including a daylight-saving boundary.
- **20 browser tests passed** with real IndexedDB: atomic record/operation/draft writes; concurrent duplicate saves; transaction rollback; database reopen; account isolation; reconnect; lost server response; expired Auth simulation; both conflict resolutions; date/UUID collisions; an edit during upload; stale open drafts; tombstone preservation; date recreation; backup restoration/deduplication/conflicts; public configuration validation; wheel keyboard/mouse/synthetic touch handlers; responsive layout.
- Real responsive iframe viewports at **320, 375, 390 and 430 px** initialized with three wheels, one entry exercise and no horizontal scrolling. The browser's outer viewport override did not consistently resize an existing tab, so the responsive checks use actual independent iframe layout widths.
- Browser UI checks confirmed individual set values after Save & Next / Previous and reload; positions 05 (Romanian Deadlift) and 07 (Custom Workout); custom selection rejection and saving; Apply this set to all; final Finish workout; skipped exercise exclusion; expanded set history; and a distinct Barbell Bench Press chart.
- Built production files were served at `/g-track/`. The shell was confirmed service-worker controlled. The preview server was stopped and an ordinary HTTP request confirmed it was unavailable. Reloading the app still succeeded, restored the edited draft and allowed Save workout now to finalize a partial workout locally.
- The initial migration was **applied to the supplied Supabase project**. A live rolled-back SQL test exercised two authenticated JWT subjects, RPC validation, atomic saves, retry idempotency, revision conflict detection, deletion tombstones, cross-user read/write rejection, related receipt ownership and anonymous RPC denial. Test users and workouts were rolled back. Production workout count was verified as zero afterwards.
- Supabase security advisor found the intentional authenticated SECURITY DEFINER RPC capability; its explicit owner checks and lack of direct table write grants were verified. See the README explanation.

The synchronization browser tests use a fault-injected server implementing the revision/receipt protocol. The SQL tests exercise the real deployed database functions. They are distinct from a signed-in, multi-device network test.

## Account and physical device checks

- The owner created the Auth account privately and disabled public registration during setup. The client is configured with the supplied project URL and public publishable key.
- The owner's password has not been read, stored in source or used by the agent. Full email/password sign-in, real token refresh, and end-to-end HTTP synchronization from two owner devices still need an authenticated session.
- Physical iPhone Safari touch momentum, on-screen keyboard behavior, Home Screen installation and iOS storage eviction behavior have not been tested on hardware. Pointer drag handlers were tested synthetically, and keyboard interaction was exercised through the browser.
- There is no guarantee of continuous background sync on an iPhone. Foreground/open/reconnect/manual synchronization is implemented explicitly.

## Recommended owner smoke check

1. Open the deployed app in Safari, sign in and save a small real workout.
2. Check the header reaches Synced, then open the account on another device and confirm the sets.
3. Go offline after the shell is cached, save another workout, close and reopen FORM, reconnect, and confirm the pending operation clears once.
4. Edit the same saved workout independently on two devices while one is offline. Confirm Settings presents both versions and your chosen resolution.
5. Delete a workout on one device, sync both and verify it does not reappear.
6. Export JSON, restore it on another profile, review any conflicts and confirm no duplicated date appears.

All production histories start empty. Browser fixtures exist only on isolated localhost test origins; no personal data or backups are committed.
