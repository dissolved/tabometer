# Tabometer

A small, local-only Firefox desktop WebExtension that observes tab counts, persistent tab identities, and inactivity. It collects neutral observations: selected tabs are not necessarily tasks, and tab counts do not diagnose stress. No Exist.io integration, network requests, credentials, frameworks, runtime dependencies, or build step.

## Install and use

1. Use Firefox desktop **112 or newer** (a current supported release is recommended).
2. Open `about:debugging`, choose **This Firefox → Load Temporary Add-on**, and select this repository's `manifest.json`.
3. Click Tabometer in the extensions menu/toolbar to open settings, or use its **Preferences** in `about:addons`.
4. Inspect the last observed counts, daily observations, and collection status. **Sample now** takes a fresh snapshot; **Refresh status** reads stored data.

Temporary add-ons are removed when Firefox exits. Reloading through `about:debugging` is useful during development. A temporary installation does **not** establish restart persistence: use a locally packaged installation in a Firefox development profile that permits unsigned extensions for restart/restore testing. Do not weaken your everyday profile's signing requirements. Publication and signing are outside this milestone.

## Sampling

The default is **events + periodic sampling**, with a 15-minute alarm. Creation, removal, activation, completed page loads, pin/discard/hide changes, window changes, tab attachment/detachment, replacement, startup, and extension reload/wake trigger full reconciliation of normal windows. Bursts are coalesced while a snapshot is in flight. Page loads trigger collection but do not themselves mark a tab as selected. Rearranging a tab within a window does not affect these metrics.

Settings can switch to **events only** or **periodic sampling** without changing the observer, metrics, or storage. Periodic mode still samples activations to preserve known selection times; startup, reload/wake, and manual samples also remain enabled. The background page is allowed to unload when idle, so its wake can produce an extra reconciliation. There is no in-memory event log or debounce timer to lose. Each sample/settings write is serialized through one background writer.

Events alone do not detect a tab crossing an inactivity threshold or produce readings on quiet days. The alarm covers quiet periods while Firefox runs, but is not an exact clock. [Firefox alarms do not survive browser sessions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/alarms); the sampler recreates a missing alarm. There is no catch-up loop: startup or wake records the present, never synthetic samples for sleep or browser-closed periods. During last-window shutdown or an empty enumeration, the previous reading is retained rather than replaced with zero. A close/restore race or API/storage failure rejects the whole sample; the next event/alarm/manual action retries collection. Event-only mode may need a manual retry after a failure.

## Metrics and time policy

- `total`: all tabs in normal, non-private windows, including pinned, hidden, discarded, and extension-page tabs. Popups/devtools/private windows are excluded. Browser tab IDs are deduplicated during each enumeration.
- `inactive7Days` / `inactive30Days`: unpinned tabs whose last known access timestamp is at least 7 / 30 elapsed 24-hour days before the sample, inclusively. Thirty-day tabs also count in seven-day tabs.
- `unknownInactivity`: unpinned tabs with no usable timestamp; excluded from both inactivity counts. `eligibleUnpinned` and `pinned` make coverage inspectable.
- `firstObservedAt`: when Tabometer first observed this identity, a lower bound on age. Original creation time is always unknown, including tabs already present at installation. It is never used to infer inactivity.

Daily observations are the **last observed counts**, accompanied by their actual timestamp, local calendar date, IANA timezone, and UTC offset at collection. Today's reading is provisional. No sample means no entry, not a zero. Only the latest observation for each date is retained; this milestone deliberately does not keep an intraday history. Retention defaults to **30 local calendar dates including today**, configurable from 1 to 365. Cleanup happens on successful sampling; lowering retention takes effect at the next successful sample. It is not a wall-clock deletion guarantee while Firefox is closed.

Date keys are assigned using the machine's local timezone **at observation time**, never by slicing UTC timestamps. DST does not change inactivity's elapsed-hour thresholds. Old date keys are not relabeled after travel/timezone changes. If a local date recurs, the reading with the greatest timestamp wins. Retention uses the current local calendar, so crossing the date line can shift its cutoff. Clock changes can affect reported inactivity; future/nonfinite timestamps and values before 2000-01-01 UTC (a conservative sanity floor predating Firefox) are rejected. Full snapshots are sequential API observations, not atomic browser transactions, and busy restoration can produce intermediate readings that later samples replace.

## Firefox APIs and limitations

- **Manifest V3** uses Firefox's event background page with ES module scripts, supported from Firefox 112 per [MDN compatibility data](https://github.com/mdn/browser-compat-data/blob/main/webextensions/manifest/background.json). Firefox uses [background scripts/pages rather than extension service workers](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background). Listeners register at module evaluation without waiting for storage. No persistent background page is required. Firefox is the target; this package is not a Chrome extension.
- [`sessions.setTabValue`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/sessions/setTabValue) stores an extension-scoped UUID, first-observed time, and last-known access time. [`getTabValue`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/sessions/getTabValue) explicitly documents close/restore survival even with a different tab ID. [MDN's tabs reference](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs) recommends session values for identity across restarts. This depends on Firefox restoring session state: fresh tabs, cleared sessions, profile resets, and reinstallations cannot be matched to old identities. Missing/invalid session metadata creates a new identity without URL matching. If duplicated tabs inherit the same session UUID, the first enumerated tab keeps it and the other gets a new identity; original-versus-copy cannot be determined reliably from the copied value.
- [`Tab.lastAccessed`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/Tab) is optional and describes access time in epoch milliseconds; its documentation does not promise restart preservation or precise behavior on restore. We accept finite, positive, nonfuture values, retain the newest usable timestamp in session metadata, and include observed activation timestamps as fallback. Missing/backward API timestamps do not discard a valid saved selection time. Forward resets on restoration are indistinguishable from real selection, and can undercount inactivity; we do not override them with guessed history. Plausible but incorrect browser timestamps cannot be detected. Browser integration checks cover reload, selection, and restart; see [recorded results and limits](docs/manual-testing.md).
- Automated window transfers on Firefox 157.0.1 and Developer Edition 158.0 exposed a transient missing session identity during adoption, although an independent session marker survived. The observer keeps a small in-memory fallback for the same live tab ID and forgets it on tab closure. This cache is lost when the background unloads; durable restoration still relies on Firefox's session values. Missing metadata without that fallback starts a new identity. No browser ID is written to local storage, and no URL matching is attempted.
- An `active` tab can be in an unfocused window. Firefox has historically returned the current time for selected tabs and recorded deselection as access ([Mozilla implementation discussion](https://bugzilla.mozilla.org/show_bug.cgi?id=747338)). Thus this measures time since Firefox-reported access, **not strictly time since the last selection event**; tabs selected in background windows can appear fresh. We accept the browser timestamp but do not synthesize a new one from `active`. Activation means selection, not evidence of attention. Page loads, discarding, pinning, or moving do not independently reset inactivity. Current source [restores saved `lastAccessed` when present](https://github.com/mozilla-firefox/firefox/blob/main/browser/components/sessionstore/SessionStore.sys.mjs), but that is an implementation detail rather than a WebExtensions guarantee.

## Permissions and local data

Only `storage`, `sessions`, and `alarms` are requested. [Basic tab enumeration/events do not need the `tabs` permission](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs); that permission would expose URL/title/favicon fields. No host permissions, content scripts, history access, or `storage.sync` are used. [`incognito: not_allowed`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/incognito) makes private windows invisible; explicit filtering also excludes them.

`browser.storage.local` holds a single versioned `tabometer` object:

- `deviceId`: random installation UUID, never synced or transmitted.
- `settings`: sampling mode, alarm interval, retention.
- `daily`: date-keyed aggregate observations with timestamp/timezone/coverage.
- `lastSample`: latest successful observed aggregate.
- `tabs`: latest snapshot of tab UUID, first-observed time, unknown-creation flag, last-access time, pinned/discarded flags. Closed tabs drop out at the next valid sample; their identity can remain in Firefox's own session restore data.

`tabometerStatus` separately contains a sanitized error and its time. Exceptions are not logged or saved verbatim because browser error messages can contain URLs. Browser tab IDs are used transiently, not stored locally. No URLs, titles, domains, favicons, page content, or browsing histories are retained. Daily storage grows by at most one aggregate per observed date; current-tab metadata grows with open tabs. Whole-state writes favor simplicity over very-high-volume performance; API latency and storage limits still apply. Firefox extension storage is not an encrypted vault. Firefox's session restore data has its own lifecycle and is not purged by aggregate retention.

There is no earlier schema to migrate. Unknown versions or malformed top-level state fail visibly without overwriting the store. Future schema changes must add explicit migrations. To inspect or back up JSON, use the extension's background debugger console:

```js
await browser.storage.local.get(["tabometer", "tabometerStatus"])
```

Data is ordinary JSON and can be copied from the debugger. A dedicated export/delete UI is deferred. Uninstalling normally removes extension storage; this does not delete session restore data or backups maintained by Firefox/profile tooling.

## Development and checks

Use Node.js 22+; no `npm install` is necessary:

```sh
npm test
npm run check
```

Tests use Node's built-in runner and fake browser interfaces, with no live browser/network/account writes. Coverage includes multiwindow/privacy filters, pinned/discarded tabs, inclusive inactivity thresholds, unknown/anomalous timestamps, restoration with changed IDs, copied UUIDs, fresh install/restart, alarm recreation, mode changes, event coalescing, errors/recovery, unsupported storage, local midnight, DST, timezone changes, and no false shutdown zeros. The check script validates JS syntax, manifest privacy assertions, and entrypoint existence; it is **not** Mozilla's full extension validator.

### Automated Firefox checks

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and Firefox desktop, then run:

```sh
npm run test:firefox
# Or directly, without Node:
uv run scripts/firefox-checks.py
```

The script declares its test-only dependency (`marionette-driver==3.7.1`) inline; uv supplies Python 3.11+ and downloads dependencies on the first run. No geckodriver or extension build tooling is needed. Firefox is found on PATH or at its usual macOS location. Override the binary when needed:

```sh
uv run scripts/firefox-checks.py --firefox /path/to/firefox
uv run scripts/firefox-checks.py --headed --skip-alarm
uv run scripts/firefox-checks.py --firefox '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox' --restart
```

Each run creates and deletes its own disposable profile and test package. It launches a separate headless Firefox instance, leaving your everyday profile and temporary installation alone. The test package adds a local fixture page and scenario module; production source and permissions are packaged unchanged. Failures exit nonzero and print Firefox's recent log. `--headed` shows the test browser; `--skip-alarm` explicitly skips the real one-minute wait. A complete run normally takes about 1–2 minutes.

The suite checks options controls, permissions, storage field allowlists, normal/private/popup windows, pinned/hidden/discarded tabs, repeated window transfers, exact-session close/restore, duplication, reload versus selection, mode switching, a real alarm, daily dates/offsets, retention, schema rejection/recovery, and natural event-page suspension/message wake. It shortens the background idle preference only inside the disposable profile, observes suspension from Firefox's parent process, and restores a long idle timeout for other checks. An attached background debugger is not used.

An HTTP observer attributes requests to the extension during installation and lifecycle checks. A test-only GET to an ephemeral loopback server proves the observer works; its count is reset before production scenarios, which must make zero HTTP(S) requests. It neither records request URLs nor contacts external accounts. Firefox itself can make unrelated browser-service requests. The observer ends before optional browser restart, so it does not establish absence of requests during restart.

`--restart` requires [Developer Edition or Nightly for unsigned persistent installation](https://extensionworkshop.com/documentation/develop/testing-persistent-and-restart-features/). Only the disposable profile disables signature checking. This option performs an actual browser restart, checking restored UUID/first-observed time, activity metadata, local data, settings, and alarm recreation. Default runs explicitly skip this check because temporary add-ons disappear on exit. Do not point the runner at an existing profile; it intentionally has no profile argument.

The harness uses [Mozilla Marionette](https://firefox-source-docs.mozilla.org/python/marionette_driver.html) and Firefox internals for private/hidden windows and background lifecycle observation. Those internal interfaces may change; tested versions are recorded in [test results](docs/manual-testing.md). It enables [remote system access](https://firefox-source-docs.mozilla.org/remote/Security.html) only for the owned test process. The extension's minimum Firefox version does not imply every older release supports this harness. OS sleep/wake and visual installation/permissions review remain manual; mathematical DST/midnight boundaries remain deterministic unit tests rather than changing the host clock.

## Manual Firefox acceptance checklist

Progress and deferred checks are recorded in [test results](docs/manual-testing.md). Guided walkthrough results were reported by the user; a separate section records automated browser runs.

1. Temporarily install; check `about:debugging` for manifest errors. Inspect the background context, check the console and storage, open settings, and verify its initial sample and device UUID. Confirm permissions contain no website/tab-content access and private browsing is unavailable.
2. Open two normal windows and a private window. Compare counts, including pinned, hidden (if available), and discarded tabs. Confirm private/popup windows are excluded. The options tab itself counts.
3. Create, close, restore, duplicate, move, select, pin/unpin, discard, and reload tabs. Confirm daily aggregates update, no duplicates remain, page loads do not reset inactivity, and selection updates `lastAccessedAt`. Inspect `browser.sessions.getTabValue(tabId, "tabometer.identity.v1")` for a known normal tab before/after close/restore.

   Use a loaded, nonblank test page such as `https://example.com/` for close/restore testing. When creating the test tab through `browser.tabs.create()`, use an ordinary HTTPS URL: Firefox rejects privileged internal pages ([tabs.create restrictions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/create)). Firefox can omit empty `about:blank`, home, and new-tab pages from its closed-tab restore list ([SessionStore implementation](https://github.com/mozilla-firefox/firefox/blob/main/browser/components/sessionstore/SessionStore.sys.mjs)). Calling `browser.sessions.restore()` without a session ID can then restore an unrelated previously closed tab, making identity comparisons invalid. Confirm the intended page was restored; preferably obtain its entry using `browser.sessions.getRecentlyClosed()` and pass that entry's `tab.sessionId` explicitly to `restore()`.

4. In a disposable development profile with a restart-capable installation, enable previous-session restoration, restart Firefox, and compare UUIDs/first-observed times and `lastAccessed` with saved session metadata. Also test an idle background page unloading and waking. Temporary reload alone does not prove restart persistence.
5. Try all sampling modes. Use a one-minute interval for testing. Leave Firefox quiet, sleep/wake the computer, and close/reopen the browser. Confirm missing periods never become zero/catch-up days; events-only quiet periods remain unsampled. Restore the desired interval.
6. Inspect daily dates and UTC offsets around local midnight, timezone changes, and DST (pure tests cover these without changing your machine clock). Confirm current-day readings replace earlier values and retention prunes old dates on sampling.
7. In a disposable profile, introduce an unsupported stored schema and confirm collection reports failure without replacing it; restore backed-up data and retry. Verify outgoing extension traffic is absent and stored data excludes browsing fields.

Most repeatable steps above now also have automated browser checks. OS sleep/wake remains explicitly deferred; see the results log for exact verification scope. No Exist API is involved in this milestone.
