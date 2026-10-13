# Local data, privacy, and snapshot history

Storage details and current preview behavior. See the [user guide](../README.md) for setup and the [measurement reference](measurements.md) for count definitions.

## Permissions and local data

Only `storage`, `sessions`, and `alarms` are requested. [Basic tab enumeration/events do not need the `tabs` permission](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs); that permission would expose URL/title/favicon fields. No host permissions, content scripts, history access, or `storage.sync` are used. [`incognito: not_allowed`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/incognito) makes private windows invisible; explicit filtering also excludes them.

`browser.storage.local` holds a single versioned `tabometer` object:

- `deviceId`: random installation UUID, never synced or transmitted.
- `settings`: sampling mode, alarm interval, retention.
- `daily`: date-keyed aggregate observations with timestamp/timezone/coverage.
- `lastSample`: latest successful observed aggregate.
- `tabs`: latest snapshot of tab UUID, first-observed time, unknown-creation flag, last-access time, pinned/discarded/selected flags. Closed tabs drop out at the next valid sample; their identity can remain in Firefox's own session restore data.

`tabometerStatus` separately contains a sanitized error and its time. Exceptions are not logged or saved verbatim because browser error messages can contain URLs. Browser tab IDs are used transiently, not stored locally. No URLs, titles, domains, favicons, page content, or browsing histories are retained. Daily storage grows by at most one aggregate per observed date; current-tab metadata grows with open tabs. Whole-state writes favor simplicity over very-high-volume performance; API latency and storage limits still apply. Firefox extension storage is not an encrypted vault. Firefox's session restore data has its own lifecycle and is not purged by aggregate retention.

There is no earlier schema to migrate. Unknown versions or malformed top-level state fail visibly without overwriting the store. Future schema changes must add explicit migrations. To inspect or back up JSON, use the extension's background debugger console:

```js
await browser.storage.local.get(["tabometer", "tabometerStatus"])
```

Daily data is ordinary JSON and can be copied from the debugger. A dedicated daily export/delete UI is deferred; snapshot history has its own inspector and delete control. Uninstalling normally removes extension storage; this does not delete session restore data or backups maintained by Firefox/profile tooling.

## Snapshot history preview

Settings shows storage usage and quota immediately above snapshot history, refreshed on page load and after options actions. [`navigator.storage.estimate()`](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate) reports approximate usage/quota for the extension origin containing the snapshot database; values can lag writes and are not an exact physical disk measurement. Quota is an estimated limit, not allocated/reserved space or a promise of available disk capacity. Firefox isolates [`storage.local` in a separate storage principal](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/extensions/ExtensionStorageIDB.sys.mjs), so daily data/settings are shown separately using [`storage.local.getBytesInUse(null)`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/StorageArea/getBytesInUse) (supported from Firefox 144). That is a logical-size figure, not an additional physical-disk measurement; the UI does not sum the two. Missing, failed, or invalid readings show **Unavailable** independently, without blocking the other settings controls. Package files and Firefox session metadata are not included. No new permission or data persistence is needed for the display.

The first slice of the [activity-history plan](activity-history-plan.md) adds optional local snapshot history. Enable **Keep snapshot history** in settings, then collect a sample. It is **off by default**, including on existing installations. The sampling mode and event coalescing still apply: this keeps every successfully collected snapshot while enabled, not every individual browser event. It cannot yet measure all tab selections, foreground duration, idle periods, or switching sequences.

Each record retains the aggregate and a minimal per-tab snapshot: UUID, first observed, last known access, unknown original creation, pinned/discarded flags, and whether selected in its window. Selection is not focus or attention; multiple windows can have selected tabs. The latest-state tab snapshot now also includes that selection flag. No URLs, titles, domains, browser tab IDs, or page content are retained. This adds timestamp-linked history, a meaningful expansion beyond the original latest-per-day readings, without new permissions.

History lives in native IndexedDB (`tabometer-history`), separate from the existing `storage.local` daily store. On first capture, existing daily readings are imported once as `legacy-daily` records with no tab snapshots. Their timestamps/UUIDs are not rewritten and missing activity is not invented. Import, its marker, and the first new snapshot commit in one [IndexedDB transaction](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction). A sequence orders committed records, including readings with equal timestamps. Retrying the same record ID is idempotent. Unknown database versions and mismatched installation UUIDs fail visibly.

**This preview has no automatic age-based retention or condensation yet.** The daily retention setting applies only to the existing daily store. History stops accepting new records at **100,000 records** (including imports); disk quota may be reached sooner, especially with many tabs. No old records are silently evicted. Settings can inspect the latest 20 records and the total count, pause collection, or explicitly delete history. Deletion pauses capture, preserves daily readings/tab identities, and prevents reimport of deleted legacy records when re-enabled. Firefox's separate session values are not deleted. Full history export and automatic condensation remain subsequent slices; recent JSON can currently be copied from the inspector.

Daily collection and history are independent stores, not one cross-database transaction. Daily readings commit first; if history fails, the daily reading remains valid and the operation reports failure. History status retains the number and time of missed snapshots even after a later successful capture clears its current error. Failed snapshots cannot be reconstructed from the daily store and are not silently backfilled. A failure to save the daily reading prevents history capture for that attempt. As with browser storage generally, a catastrophic OS crash can lose recently committed writes.

`tabometerHistorySettings` and `tabometerHistoryStatus` are local preference/status keys. History reads are bounded and use a short-lived database connection, allowing the event background page to unload. Aggregate and history writes use the same controller queue. No remote integration or idle permission has been added.

