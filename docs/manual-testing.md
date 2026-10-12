# Manual Firefox test results

Guided walkthrough on 2026-10-11. Results below were reported by the user in their temporarily installed Firefox extension; the agent did not directly control or observe Firefox. Firefox version was not recorded. No automated real-Firefox integration harness has been set up.

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

- Background event-page unloading and wake with the debugger closed, separately from OS sleep.
- Browser shutdown/restart and previous-session restoration: identity, first-observed/activity metadata, device UUID, local observations, settings, and alarm recreation. Use a disposable profile and a restart-capable installation; temporary reload is not a restart test.
- Discarded and hidden tabs, popup-window exclusion, and an explicit permission review. These were not individually exercised in the guided count test.
- Pin/unpin effects on inactivity coverage, and browser-level handling of missing/anomalous activity timestamps. Exact seven/thirty-day thresholds already have pure unit tests.
- Local midnight/day rollover, recorded timezone/offset, DST/timezone changes, and retention cleanup in Firefox. Pure calculations already have automated boundary coverage.
- Unsupported-schema failure/recovery in a disposable profile, preserving original data for restoration. Automated tests already cover the storage interface behavior.
- Extension network inspection for absence of outgoing requests. Local metadata was inspected, but a full network inspection was not reported.

## Test pitfalls found during the walkthrough

- Empty `about:blank` tabs may not enter Firefox's closed-tab restore list; an unqualified `sessions.restore()` can restore a different old tab.
- Firefox rejected creating `about:mozilla` through `tabs.create()`; use a fully loaded ordinary test page such as `https://example.com/`.
- Early multi-step identity comparisons mismatched. A subsequent self-contained probe with fresh metadata and an explicit session ID passed. No extension identity defect was established; stale variables or a different restored session remain possible explanations.

## Automation candidates

Firefox-specific automation using Marionette or Selenium/geckodriver, with a disposable profile and extension installation, could cover tab/window operations, options controls, local state, restoration, and selected failure cases. `web-ext` can launch Firefox with the extension and validate the package, but is not by itself an assertion-based integration test suite. Restart tests need deliberate persistent-profile and installation setup. Background lifecycle tests must avoid accidentally holding the background page alive through an attached debugger.

References: [Mozilla Marionette add-on API](https://firefox-source-docs.mozilla.org/python/marionette_driver.html), [web-ext development tools](https://extensionworkshop.com/documentation/develop/browser-extension-development-tools/), [persistent/restart testing](https://extensionworkshop.com/documentation/develop/testing-persistent-and-restart-features/).
