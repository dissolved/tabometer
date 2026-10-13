# Manual Firefox checks and test results

Guided walkthrough on 2026-10-11. Results in the first section were reported by the user in their temporarily installed Firefox extension; Firefox version was not recorded. Subsequent automated runs use separate disposable profiles and are recorded separately below.

## Passed (user reported)

- Temporary installation, settings, initial sample, daily entry, error-free status, device UUID, and inspection of locally stored tab metadata without URLs/titles.
- Normal-window tab counts, pinned count changes, private-window exclusion, and counts returning to baseline after closing test windows.
- Close/restore preserves UUID and first-observed timestamp with a changed Firefox tab ID. A separate session marker also survived. The conclusive probe captured fresh metadata and restored a specific closed-session ID in one operation.
- Duplicated tabs receive distinct UUIDs.
- Moving a tab into a new window preserves UUID and first-observed timestamp.
- Hybrid mode samples a quiet period using a one-minute alarm with unchanged tab count.
- Events-only mode disables the alarm, leaves a quiet period unsampled, and samples background tab creation.
- Periodic mode ignores background tab creation before its alarm, and manual sampling reconciles the new tab.
- Background reload preserves identity and activity timestamp; selecting the test tab advances the activity timestamp.

The user restored hybrid mode with a 15-minute interval after the sampling-mode checks. The later sleep-test instructions proposed temporarily changing to one minute, but the user deferred that test; the resulting interval was not reconfirmed.

## Deferred: sleep/wake recovery

**Explicitly skipped by the user; verify later.**

1. Select hybrid mode with a one-minute interval, save, and sample manually.
2. Close the extension debugger so it does not keep the background page alive.
3. Sleep the computer for 2–3 minutes, wake it, and wait approximately 75 seconds.
4. Open settings and refresh status. Check a newer sample timestamp, correct normal-tab count, no collection error, and one latest daily entry for today.
5. Restore the 15-minute interval.

An up-to-date reading after opening settings does not independently prove an alarm fired during wake: the background page can reconcile when it starts. Inspect the reason and timestamp for that distinction. The daily-only store also cannot establish whether intermediate samples occurred. OS sleep remains a real-system check, not equivalent to advancing a fake clock.

## Remaining manual checks

- The explicitly deferred OS sleep/wake check above, preferably on the everyday machine and usual profile. Browser background suspension is a different condition.
- Visual installation/permission wording, usability, and accessibility review in Firefox's actual interface. Automation asserts manifest/runtime permissions and operates the options controls, but does not judge their presentation.
- Optional real-world observation across midnight, travel/timezone changes, and Firefox upgrades. Deterministic unit tests cover DST/midnight/timezone boundaries without changing the host clock; the browser suite checks actual local date/offset and seeded retention.

Browser restart is automated with `--restart`; default temporary-install runs skip it explicitly. No requirement to repeat the other automated lifecycle checks manually remains. A green suite is limited to its exercised paths and browser versions, not a general guarantee about Firefox session restoration.

## Test pitfalls found during the walkthrough

- Empty `about:blank` tabs may not enter Firefox's closed-tab restore list; an unqualified `sessions.restore()` can restore a different old tab.
- Firefox rejected creating `about:mozilla` through `tabs.create()`; use a fully loaded ordinary test page such as `https://example.com/`.
- Early multi-step identity comparisons mismatched. A subsequent self-contained probe with fresh metadata and an explicit session ID passed. No extension identity defect was established; stale variables or a different restored session remain possible explanations.

## Automated Firefox coverage

Run `uv run scripts/firefox-checks.py` or `npm run test:firefox`; see [setup and flags](development.md#automated-firefox-checks). The runner uses Marionette, a disposable profile, local fixture pages, and the unchanged production manifest/source plus test-only fixtures. It needs no real accounts or browsing data. Python tooling is a development dependency only.

Assertions cover:

- Fresh install, device UUID, options status/sample/settings controls, and error-free collection.
- Exactly the three intended permissions, no host/private access, tab/aggregate field allowlists, and empty sync storage.
- Normal/private/popup window counts, pin/unpin coverage, hidden/discarded tabs, close/window removal, and repeated window transfers.
- Exact-session close/restore with a changed browser ID and independent session marker; unique identities after duplication.
- Reloading an inactive tab leaves its access time unchanged; selection advances it.
- Events-only quiet periods and creation, polling exclusion of background creation, manual reconciliation, selection fallback, and a real one-minute hybrid alarm.
- Natural background suspension and message wake, including device/tab identity preservation. The debugger is not attached; only the test profile's idle timeout is shortened.
- Current local date/timezone/offset, latest-per-day replacement, pruning seeded old observations, unsupported-schema preservation, visible failure, and recovery.
- Zero extension-originated HTTP(S) traffic during installation and lifecycle scenarios. A separate loopback ping self-tests request attribution and is excluded from the zero-count assertion. Firefox's unrelated service requests are excluded, and the observer does not span browser restart.
- With `--restart`, an actual browser restart with persistent unsigned installation: restored UUID/first-observed time, retained known activity, installation UUID, settings/daily data, and recreated alarm. The runner prints before/after activity timestamps; Firefox resetting them forward remains a documented API limitation.

Pure tests remain responsible for exact seven/thirty-day thresholds, anomalous/missing timestamps, mathematical timezone boundaries, storage-write failures, and shutdown's empty-enumeration behavior. The browser suite does not change the OS clock, sleep the computer, or infer samples during closed/suspended periods.

### Regression found while automating

On Firefox 157.0.1 and Developer Edition 158.0, a window move intermittently changed UUID and first-observed time. Test-only tracing showed `getTabValue()` returning no identity during adoption, while a separately saved session marker survived afterward. This is distinct from the earlier inconclusive manual snippets. The controller now caches metadata for each live tab ID in memory, bridges a missing-value read, and forgets closed IDs. A unit regression and ten round trips between windows exercise the fix. Background unload clears the cache; persistent restore still depends on Firefox's session data. No matching by URL or new persisted browser IDs was added.

### Automated run log

Verified on 2026-10-11 using headless macOS Firefox and owned disposable profiles. Initial failures during harness development were corrected; the move regression above prompted a production fix rather than weakening assertions.

- Firefox 157.0.1: full post-fix default suite passed, including repeated transfers, network assertions, and a real one-minute alarm. Browser restart was explicitly skipped because this run used a temporary installation.
- Firefox Developer Edition 158.0: full post-fix suite passed, including repeated transfers, network assertions, real one-minute alarm, and persistent-install restart.
- A final Developer Edition run with `--restart --skip-alarm` also passed the explicit retained-activity assertion: the inactive fixture's access timestamp was unchanged across restart. This observation is not a promise for all restore scenarios or Firefox versions.

The minimum supported extension version (112) was not browser-tested. These tests use Firefox internal APIs that may need adjustment on other releases. No manual sleep/wake or real Exist verification was performed.

### Snapshot-history slice: 2026-10-12

Verified using Node 24.21.0 and headless macOS Firefox 157.0.1 in disposable profiles:

- All 16 unit tests and manifest/entrypoint/JavaScript syntax checks passed.
- A full default Firefox run passed the existing lifecycle/privacy/UI checks, real one-minute alarm, and zero extension HTTP(S) traffic assertion. Added history checks passed: explicit opt-in, same-day snapshots, once-only legacy daily import, reopening IndexedDB, pause, inspector and confirmed deletion, preserved identities/daily readings, and no reimport after deletion.
- Real IndexedDB tests forced a unique-index failure after enqueueing import writes: the transaction left no partial records or marker. Subsequent import succeeded; repeating its sample ID had no duplicate effect. Cap failures preserved records, recent reads were bounded/ordered, and deletion prevented legacy reimport.
- The final follow-up run used `--skip-alarm` and passed all remaining checks, including history surviving natural event-page suspension and message wake. The alarm had already passed in the full run; it was explicitly skipped in this follow-up. Test setup resets only the history database/preferences afterward so the first-enable import scenario starts independently.

During harness development, a settings poll initially dereferenced a not-yet-written preference; the poll now tolerates that expected asynchronous state. A second suspension check after switching from a long idle timeout timed out. The check now runs with the short timeout established at installation: Firefox's idle manager can retain an already scheduled timer when its preference changes. The final run observed actual suspension from the parent process; it did not force background termination or attach a debugger.

Browser restart with the new history store was **not run**: Developer Edition/Nightly was unavailable. The optional `--restart` scenario now includes history preference/record preservation, ready for a compatible installation. OS sleep/wake, manual idle/lock behavior, visual/accessibility review, minimum Firefox 112, large-history performance, and disk-quota exhaustion remain unverified. Cap and transaction-abort tests do not establish physical disk-quota or power-loss behavior. No Exist requests were made. Idle detection is not implemented in this slice.

### Storage usage display: 2026-10-12

- All 18 unit tests and static checks passed on Node 24.21.0. Added coverage verifies that origin usage/quota remain separate from local logical bytes, zero usage is valid, and missing/rejected/invalid API readings show unavailable independently.
- Firefox 157.0.1 disposable-profile suite passed with `--skip-alarm`, including the new UI check against native `navigator.storage.estimate()` and `storage.local.getBytesInUse(null)`, placement above snapshot history, refreshed display, existing history/lifecycle checks, and no extension HTTP(S) requests.
- The real alarm and browser restart were explicitly skipped for this UI-only change. Firefox 112 fallback behavior was not browser-tested; missing APIs are covered through injected interfaces. No manual presentation/accessibility or physical-disk accounting comparison was performed. Browser estimates are not exact total extension disk usage or reserved capacity.

References: [Mozilla Marionette add-on API](https://firefox-source-docs.mozilla.org/python/marionette_driver.html), [web-ext development tools](https://extensionworkshop.com/documentation/develop/browser-extension-development-tools/), [persistent/restart testing](https://extensionworkshop.com/documentation/develop/testing-persistent-and-restart-features/).

### Settings page design: 2026-10-13

- All 18 unit tests and static checks passed. The Firefox 157.0.1 suite passed with `--skip-alarm` in a disposable profile, including new checks for loaded header artwork, summary counts matching the sample, daily table row coverage, and today's provisional label. Existing settings, history inspection/deletion, storage display, privacy and lifecycle checks passed.
- Reviewed full-page Firefox screenshots in light and dark themes. A narrow-window capture had no document-level horizontal overflow; the daily table scrolls within its region. These captures used a temporary wrapper around the existing harness, with synthetic disposable-profile observations.
- Real alarm and browser restart were explicitly skipped. No manual screen-reader, keyboard walkthrough, minimum-version Firefox, or real-account checks were performed. Native controls, semantic headings/table headers, live status messages, visible focus styles, and reduced-motion support are provided, but this is not a full accessibility audit.

## Manual Firefox acceptance checklist

Progress and deferred checks are recorded in the [run log](#automated-run-log) and [remaining manual checks](#remaining-manual-checks). Guided walkthrough results were reported by the user; a separate section records automated browser runs.

1. Temporarily install; check `about:debugging` for manifest errors. Inspect the background context, check the console and storage, open settings, and verify its initial sample and device UUID. Confirm permissions contain no website/tab-content access and private browsing is unavailable.
2. Open two normal windows and a private window. Compare counts, including pinned, hidden (if available), and discarded tabs. Confirm private/popup windows are excluded. The options tab itself counts.
3. Create, close, restore, duplicate, move, select, pin/unpin, discard, and reload tabs. Confirm daily aggregates update, no duplicates remain, page loads do not reset inactivity, and selection updates `lastAccessedAt`. Inspect `browser.sessions.getTabValue(tabId, "tabometer.identity.v1")` for a known normal tab before/after close/restore.

   Use a loaded, nonblank test page such as `https://example.com/` for close/restore testing. When creating the test tab through `browser.tabs.create()`, use an ordinary HTTPS URL: Firefox rejects privileged internal pages ([tabs.create restrictions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/create)). Firefox can omit empty `about:blank`, home, and new-tab pages from its closed-tab restore list ([SessionStore implementation](https://github.com/mozilla-firefox/firefox/blob/main/browser/components/sessionstore/SessionStore.sys.mjs)). Calling `browser.sessions.restore()` without a session ID can then restore an unrelated previously closed tab, making identity comparisons invalid. Confirm the intended page was restored; preferably obtain its entry using `browser.sessions.getRecentlyClosed()` and pass that entry's `tab.sessionId` explicitly to `restore()`.

4. In a disposable development profile with a restart-capable installation, enable previous-session restoration, restart Firefox, and compare UUIDs/first-observed times and `lastAccessed` with saved session metadata. Also test an idle background page unloading and waking. Temporary reload alone does not prove restart persistence.
5. Try all sampling modes. Use a one-minute interval for testing. Leave Firefox quiet, sleep/wake the computer, and close/reopen the browser. Confirm missing periods never become zero/catch-up days; events-only quiet periods remain unsampled. Restore the desired interval.
6. Inspect daily dates and UTC offsets around local midnight, timezone changes, and DST (pure tests cover these without changing your machine clock). Confirm current-day readings replace earlier values and retention prunes old dates on sampling.
7. In a disposable profile, introduce an unsupported stored schema and confirm collection reports failure without replacing it; restore backed-up data and retry. Verify outgoing extension traffic is absent and stored data excludes browsing fields.

Most repeatable steps above now also have automated browser checks. OS sleep/wake remains explicitly deferred; see the results log for exact verification scope. No Exist API is involved in this milestone.
