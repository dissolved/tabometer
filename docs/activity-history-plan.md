# Next iteration: local tab activity history

Status: proposed plan, 2026-10-12. This document does not enable collection or change runtime permissions.

Implementation progress: the first snapshot-history slice is implemented as an opt-in preview. It retains aggregate/per-tab snapshots, transactionally imports old daily readings without fabricated tab history, and provides bounded inspection and confirmed deletion. The existing daily storage schema remains the authoritative source for existing metrics; history is an independent IndexedDB store, so its failure does not prevent daily collection. A visible missed-snapshot counter records history failures. For this preview, the 100,000-record cap applies without automatic pruning; the proposed seven-day detail/90-day summary retention must wait for transactional condensation. Full event capture, foreground/idle measurement, cross-day activity summaries, and export remain subsequent slices. See [local data and snapshot history](data-and-privacy.md) for exact shipped behavior and limitations.

## Outcome and boundaries

Preserve enough local evidence to examine attention patterns, tab persistence and returns, long return delays, switching patterns, and daily routines. These are observations of browser state, not measurements of attention, intent, avoidance, productivity, or stress.

Keep normal non-private windows in scope. Capture no URLs, titles, domains, page content, input contents, or navigation history. No network reporting, content scripts, `tabs` permission, or broad host permissions. Existing total/stale-tab definitions and representative daily observations remain available.

Detailed timestamps linked to tab UUIDs are a meaningful expansion of collection even without page identities. Explain the expansion in settings and README; existing installations start with activity history disabled until explicitly enabled. Existing aggregate collection continues. Pinned tabs participate in activity history; the existing stale-count exclusion remains unchanged.

## Questions and evidence

| Question | Evidence to retain | Derived observations |
| --- | --- | --- |
| How does browser focus move? | Tab selection, focused normal window's selected tab, focus loss/return | Foreground entries and approximate foreground intervals per tab |
| Which tabs persist or get revisited? | UUID, first observed time, observed presence/removal/return, selections | Persistence, foreground return count, intervals between returns |
| How long before returning? | Prior known foreground exit and next foreground entry; last known access separately | Known return delay or explicit lower bound/unknown; never an avoidance label |
| How fragmented is selection? | Ordered foreground transitions with receipt timestamps | Switch counts, interval distribution, switches per observed foreground hour |
| What browser routines occur? | Focus episodes, optional idle transitions, checkpoints, gaps, local date/timezone | First/last observed foreground use, daily time distribution, focus/idle gaps |

Retain all accepted aggregate samples while detailed collection is enabled. Retain a minimal per-tab membership/state snapshot at each successful full reconciliation, including its selection state. Record activity events separately: snapshots cannot recover selections between them.

## Capture model

- Samples: existing aggregate fields, sample ID, timestamp, timezone/offset, and references to per-tab observations (UUID, first observed, last known access, pinned/discarded/selected state). Never copy entire browser objects.
- Events: unique event ID, monotonic sequence within the persisted log, callback receipt time, local date/timezone/offset, kind, relevant tab UUID(s), and source/quality classification. Browser events do not generally provide an authoritative action timestamp.
- Event kinds: selection, foreground change, focus lost/returned, tab first observed/removed/reappeared, pin/discard changes, optional idle-state change, checkpoint, collection enabled/disabled, and observation discontinuity. Full snapshots reconcile state missed between events.
- Runtime tab/window IDs are transient lookup keys. Persist only extension-assigned tab UUIDs and, if needed to interpret selection in multiple windows, randomly assigned observation-window keys with no restart identity guarantee.
- Tab record: original creation unknown, first/last observed, last known API access, last foreground entry/exit, and last observed removal. Keep compact continuity metadata for open tabs beyond raw retention; retain closed-tab continuity only within the configured history horizon.
- Restored session UUIDs link returns when Firefox preserves them. Same URL in a newly opened tab cannot be linked. A new tab notification during restoration is not proof of a newly created browsing intention. Reappearance without a recorded removal is classified as uncertain. Duplication creates a separate identity; window transfers do not count as closure/reopening.
- Preserve selection events individually even when snapshot requests coalesce. Register listeners synchronously, timestamp at entry, and serialize persistence. Resolve identity before forgetting removed-tab mappings. An unresolved identity remains an explicit unknown event rather than being silently attributed or discarded.
- Record every delivered selection event but distinguish it from a foreground change. Selecting in an unfocused window does not start foreground time. Returning to the same tab after switching applications is a focus return, not a tab switch. A foreground return requires a previously observed foreground visit; initial reconciliation is not a return.

## Foreground, idle, and gaps

Use tab activation and window focus together to identify the selected tab in the focused eligible window. At most one tab receives foreground time. Focus leaving eligible windows stops attribution without recording which application or private/popup window took focus.

Propose optional `idle` permission, requested only by a user action enabling idle-aware measurement. Default idle threshold: five minutes, stored with observations. Device idle is system-wide; collect its state only as context for browser foreground measurement, not a standalone record of other-app usage. Persist relevant transitions while eligible browser focus exists and query current state when focus returns. Unsupported lock detection is unknown, never assumed active. Without permission, report foreground time including possible idle time; do not call it active use.

Use a one-minute checkpoint alarm while history is enabled, separate from the configurable full-snapshot alarm. Checkpoints query only focus/selected-tab/optional idle state, not all tab metadata. Recreate alarms on startup and measure actual elapsed time; alarm delivery is not exact.

Persist interval checkpoints and the observation epoch. On restart, crash, delayed checkpoint (initial proposed threshold: more than two minutes), clock reversal, or unreconciled wake, stop attribution at the last confirmed checkpoint and mark the remainder unknown. Do not stretch the last selected tab across an unobserved night. Ordinary MV3 background suspension must preserve durable state and must be tested separately from browser restart. Even timely checkpoints establish an estimate of continuity, not proof of activity between readings. Validate the two-minute tolerance in browser tests and document it.

Idle-filtered time is based on reported transitions; the five-minute detection delay is not a precise last-input time. Do not backdate it as if it were. Preserve known foreground time and idle-filtered foreground time as separate quantities. No keyboard/mouse listeners or polling of page content.

References: [tab activation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/onActivated), [window focus](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows/onFocusChanged), [idle API and permission](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/idle), [nonpersistent background scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts), [alarms](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/alarms).

## Retention and condensation

Proposed defaults: detailed samples/events for seven local calendar dates including today; daily summaries for 90 dates. Keep existing aggregate retention preference (default 30 dates) separate and explain the three horizons. Allow configuration of detail retention from 1–30 days and summaries from 30–365 days. Active-tab continuity records are not historical event logs and have a separate lifecycle.

During maintenance, roll older details into versioned daily summaries before deleting them. Include aggregate last/min/max observed counts, samples observed, selections, foreground entries/returns/switches, foreground and idle-filtered milliseconds, duration/return-delay histogram bins, first/last observed use, hourly time totals, unknown coverage, and observed persistence/inactivity distributions. Retain per-tab daily counts/times and return-delay bins for the summary horizon so cross-day tab patterns remain possible. Label long delays crossing missing coverage as uncertain; preserve endpoints without pretending the gap was monitored.

Summaries intentionally lose exact order and individual timestamps. Record their schema, source sequence ranges, timezone policy, and coverage. Store sums/counts or bins rather than averaging already-averaged values. Do not report a sample-weighted tab average as a time-weighted average: event-heavy periods oversample changes. Time-weighted quantities require bounded intervals and explicit coverage.

Maintenance runs on startup and an alarm, in bounded transactions/batches. Rollups must be idempotent; interruption cannot double counts or delete uncommitted source data. Raw records, corresponding rollup changes, and progress markers commit atomically. Do not use an in-memory midnight timer as the only trigger.

Use the local date assigned at observation time; preserve timezone and UTC offset. Split attributable intervals at local midnight and observed timezone changes. Do not reinterpret old dates after travel. DST uses actual elapsed duration. If the timezone/clock transition cannot be located, mark the ambiguous interval unknown. Missing days remain missing. Today's summaries are provisional.

## Persistence and migration

Use native IndexedDB for the growing append log, tab observations, summaries, and durable collector checkpoint, with indexes by time/date/tab. This avoids rewriting the entire history on every selection and supports transactional rollup/deletion. No runtime library or bundler is required. Keep preferences and sanitized status in `storage.local`; do not request `unlimitedStorage` initially.

Migration imports existing UUIDs, current metadata, and daily readings once, with a durable migration marker in the same database transaction. Old daily readings remain representative aggregates with unavailable activity history, never synthesized events. Preserve the source v1 object until import validation succeeds; interrupted import is retryable and never generates a new installation UUID. Unknown schemas fail visibly. One serialized writer owns collector state; settings changes enter the same queue. Avoid treating separate storage.local and IndexedDB writes as a single atomic transaction.

Expose approximate usage/record counts, quota/storage errors, oldest detail, oldest summary, and last maintenance. Failed writes do not advance persisted checkpoints. Subsequent recovery marks an observation gap. Set a documented hard detail-record cap (initial proposal: 100,000 records); on reaching it, stop new detail capture visibly until maintenance/export/settings free capacity. Never silently drop unrolled records. Exercise high-event/large-tab workloads before fixing final defaults. Firefox quotas remain applicable: [storage.local limits](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local).

## Controls

Extend the options page with history enable/pause, optional idle detection, retention preferences, collection coverage/status, record counts, and a small recent-history/daily-summary inspector. Include JSON export and an explicit confirmed deletion action for activity history, without resetting tab identities or existing aggregate readings. Pausing closes attribution and creates a discontinuity on resume. Deletion removes applicable log/summaries/checkpoints and suppresses regeneration from leftover records; document that Firefox session metadata has its own lifecycle. No elaborate dashboard in this iteration.

## Implementation sequence

1. Define versioned event/sample/summary schemas and pure foreground/return/rollup calculations. Add migration and transactional IndexedDB adapter. First working slice retains and inspects multiple aggregate/per-tab samples without changing existing daily results.
2. Add independently persisted selection/lifecycle/focus events and durable continuity state. Demonstrate rapid A → B → A capture, cross-window focus, close/restore, and meaningful unknowns.
3. Add bounded foreground intervals/checkpoints, optional idle support, gap handling, and midnight/timezone splitting. Measure checkpoint/write overhead in a disposable profile.
4. Add transactional condensation, retention/cap enforcement, options controls, export/delete, and documented privacy/measurement semantics. Enable only after the complete path passes tests.

## Acceptance and verification

- Pure tests: A → B → A selections, repeated/no-op focus, application return versus switch, selection in background windows, at most one attributed tab, exact interval boundaries, pinned participation, unknown timestamps, no invented original creation dates.
- History tests: multiple samples retained within a day; oldest details condense once; per-tab return context survives raw pruning; no URL/title/input fields survive serialization; daily legacy metrics unchanged.
- Persistence tests: v1 import success/interruption/retry, unsupported schemas, failed append/rollup/delete, duplicate job retry, checkpoint atomicity, quota/cap status, exported round-trip schema, pause/resume/delete behavior. Exercise real IndexedDB transactions in browser integration tests.
- Time tests: local midnight, both DST transitions, timezone/date-line changes, backwards clock, delayed alarms, crashes/restart, explicit gaps, and no synthetic zero/foreground time across absent observations.
- Browser suite: rapid switching while samples coalesce, multiple normal/private/popup windows, focus loss, move/adoption identity fallback, duplication, exact-session restoration, naturally suspended background wake, persistent-install restart, optional permission grant/denial/revocation, and no outbound traffic. Do not replace close/restore tests with URL matching.
- Manual: real OS sleep/wake and idle/lock transitions, permission wording, basic inspector/export/delete usability. Record versions and scope; idle/lock behavior must be checked on the target OS. Do not claim a green fake-clock test proves sleep behavior.
- Run `npm test`, `npm run check` (update its intentional permission assertions), and full Firefox suites including restart. Add a large synthetic history/rapid-event run to verify bounded memory, indexed range reads, and maintenance batches.

Complete when a local exported history can distinguish a quiet day from rapid switching at the same tab count, follow a tab's observed returns across days, show approximate eligible foreground intervals and coverage gaps, and condense safely without changing the existing daily count semantics.
