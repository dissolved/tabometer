# AGENTS.md — Tabometer

## Project purpose

Tabometer is a privacy-conscious Firefox WebExtension that measures how browser tabs accumulate and persist over time. Its initial integration exports daily numeric metrics to [Exist.io](https://exist.io/), where they can be considered alongside other personal metrics (such as unread email counts and self-reported stress).

**The underlying hypothesis is not that many tabs imply stress.** Productive research can legitimately open many tabs. More interesting potential signals are *tab persistence*, *time since last use*, and the gradual growth of a backlog of apparently unfinished browsing intentions. The extension should collect neutral observations, not diagnose stress or assign psychological meaning to individual tabs.

This is initially a single-user project, but prefer maintainable, portable code over assumptions tied to one machine or user account.

## Agent operating instructions

- Read this file, the README, manifest, and existing tests before making changes. Respect established conventions when code already exists.
- Work incrementally. Implement the simplest working vertical slice first; do not build roadmap features without an explicit request.
- Verify current browser API behavior, permissions, Manifest V2/V3 support, and Exist endpoints against authoritative documentation before relying on assumptions. Cite/link significant technical choices in documentation or comments where helpful.
- Prefer a small, dependency-light JavaScript/ES module codebase. Avoid frameworks, bundlers, servers, native messaging, or TypeScript unless they solve a demonstrated problem.
- Make changes with tests when practical. Run available checks, and report exactly what was and wasn't verified. Never claim manual Firefox or Exist verification unless performed.
- Never hardcode credentials, commit tokens, log tokens, or include sensitive values in fixtures. Avoid publishing or posting data to real accounts during tests.
- Do not silently broaden the extension's permissions or data collection. Explain and justify such changes.
- When an implementation decision is ambiguous, choose a reasonable minimal default, document it, and proceed. Ask only for decisions requiring user credentials, destructive actions, publishing, or other consequential consent.

## MVP scope

1. **Observe tabs locally.** Periodically sample tabs across normal Firefox windows in the current profile, initially every 15 minutes. Also sample on startup and at appropriate tab lifecycle events when useful. Account for alarms not firing while Firefox is closed or asleep.
2. **Track per-tab identity and lifecycle.** Use Firefox's `browser.sessions.setTabValue()` / `getTabValue()` to attach a UUID and a first-observed timestamp to a tab. `tab.id` alone is not durable across browser restarts. Do not treat the first-observed timestamp as the actual creation time of an already-open tab.
3. **Track inactivity.** Use `tab.lastAccessed` where available and validated. Carefully distinguish tab age from time since last selected. Document whether timestamps survive browser restarts, and handle missing, implausible, or reset values without fabricating precision. Consider maintaining last-observed activity metadata if needed.
4. **Store measurements locally.** Keep dated observations and a small amount of tab metadata sufficient to calculate historical daily metrics. Use extension storage appropriate to the volume; avoid retaining URLs, titles, or full browsing histories. Default to a documented, configurable retention period (initially 30 days), while preserving enough data for reliable retry/backfill.
5. **Compute daily metrics.** Initially measure:
   - Total open tab count.
   - Count of tabs inactive for at least 7 days.
   - Count of tabs inactive for at least 30 days.
   The stale-tab counts should exclude pinned tabs by default; total tabs should include them. Keep metric definitions explicit, consistent, and testable. Count observations, not inferred mental states.
6. **Choose a representative daily observation.** Use the last valid sample from each local calendar day for the first release, recording its timestamp. A sample does not exist when Firefox was not running; do not substitute a zero count. If an exact end-of-day reading is unavailable, label the metric as the *last observed count* rather than claiming it was taken at midnight.
7. **Export to Exist.io optionally.** Support authenticated writes of daily integer-valued custom attributes. The extension must remain useful with reporting disabled or unconfigured. Persist queued daily updates and retry recoverable failures without duplicating or silently dropping observations.
8. **Provide minimal user controls.** A simple options page should allow configuration of Exist authentication, enabling/disabling reporting, and inspecting last sample, last successful upload, and errors. Provide a manual “send now” or retry action. Avoid elaborate dashboards in v1.

## Exist.io contract and constraints

- Use the API v2 over HTTPS and consult https://developer.exist.io/guide/write_client/, https://developer.exist.io/reference/creating_attributes/, and https://developer.exist.io/reference/writing_data/.
- The `POST /api/2/attributes/create/` endpoint supports custom attributes with `label`, `group`, `value_type`, and `manual`. Numeric integer/quantity attributes use `value_type: 0`. Use `manual: false` for automatically collected data when appropriate.
- **Do not assume an attribute's API `name` from its label.** Capture and store the returned name after creation; handle attributes that already exist and any ownership conflicts explicitly.
- Updates go to `POST /api/2/attributes/update/` as JSON arrays of `{name, date, value}`. Exist stores values at **daily granularity**, not as timestamped samples. Batch where useful (up to 35 updates/request), inspect per-item failures as well as HTTP status, and make retries idempotent by date and attribute.
- Confirm the available group and OAuth write scope (likely `productivity_write`, but verify) rather than assuming them. Only the owning service can write an attribute.
- Prefer least-privilege OAuth authorization for a distributable extension. For an initial personal build, document the personal developer token option and its broader permissions, but don't silently embed that token into code or a distributable package. Store credentials in local extension storage, not `storage.sync`; warn that extension storage is not a secure credential vault. Never sync authentication secrets.
- Use the local calendar date for daily aggregation, with an explicitly documented timezone policy. Avoid losing or misdating samples around daylight-saving transitions and timezone changes. A daily export is a replacement/upsert for that date, not an increment.
- Never upload individual tab metadata, browsing history, URLs, tab IDs, or timestamps to Exist: **numeric daily aggregates only**.

## Firefox APIs and privacy

- Relevant APIs: `browser.tabs`, `browser.alarms`, `browser.sessions`, `browser.storage`. Consult MDN for exact permissions and lifetime behavior.
- Prefer using tab metadata and counts without `tabs` URL/title access if possible. Request only necessary permissions; avoid broad host permissions and content scripts unless a specific feature needs them. Network host permission for Exist may be necessary depending on the manifest architecture.
- Normal windows are in scope; exclude private browsing by default. Do not request private-browsing access as part of setup. Handle multiple windows, discarded tabs, tab moves, session restoration, and browser restart.
- Session values are scoped to an extension and can help retain tab-associated metadata across restarts. However, verify their actual persistence behavior in the targeted Firefox version; do not infer guarantees beyond the browser's documented behavior.
- `browser.storage.sync` may eventually sync **preferences**, but it is not a suitable multi-device event log. Do not sync unique local device identifiers or credentials.
- Assign and persist an installation/device UUID locally from the start to support future multi-device aggregation, even though multi-device reporting is out of scope for v1.
- Avoid collecting URLs, page titles, favicon URLs, content, or domains in the MVP. Future domain-based metrics must be opt-in, privacy-reviewed, and preferably computed locally.

## Data semantics and edge cases

- A newly installed extension cannot know when preexisting tabs were originally opened. Store **first observed** and mark initial age as unknown/lower-bounded; do not report false historical creation dates.
- Tab UUIDs and storage records may be lost on profile reset or extension reinstall. Treat those situations as new observations rather than guessing a match from URLs.
- A selected tab is not necessarily a task being worked on; inactivity is a proxy, not a classification. Don't declare a tab “unresolved” or “abandoned” as a fact.
- If `lastAccessed` is missing or unreliable, exclude the affected tab from stale counts or track an explicit unknown classification. Make reporting coverage inspectable rather than silently treating unknown as fresh.
- Sampling while Firefox is running means gaps in the record. Closed browsers and sleeping computers must not be reported as zero tabs.
- If computing historical metrics for a day that is still underway, identify them as provisional, and allow the final reading to replace them later.
- Multiple normal windows and pinned tabs must not be double-counted. State the exclusion policy for any window or tab category.
- Network failures, transient rate limits, partial Exist successes, and unexpected shutdowns must not corrupt local measurements. Avoid unbounded upload loops.

## Suggested code organization (adapt to existing files)

Keep the concepts separate rather than enforcing a particular directory tree:

- **tab observer** — enumerates tabs, associates metadata, normalizes timestamps.
- **sampler/storage** — schedules and stores observations, handles retention.
- **metrics** — pure functions calculating counts and daily summaries.
- **exist client** — creates/resolves attributes and performs authenticated batched writes.
- **reporter** — queues/retries daily exports and maintains sync status.
- **options UI** — narrow configuration and troubleshooting surface.

Pure calculations should run in unit tests without Firefox or real network access. Wrap browser APIs and HTTP calls behind small testable interfaces rather than deeply mocking platform globals everywhere.

## Testing / acceptance criteria

At minimum, cover:

- Tab count across multiple normal windows; pinned tabs included only where intended.
- Stale thresholds at exactly 7 and 30 days, including recent activity on an old tab.
- Preexisting tabs with unknown original creation time; missing or anomalous `lastAccessed` values.
- Stable metadata through supported tab/session restoration scenarios, or a clearly documented fallback when Firefox does not preserve it.
- Correct daily grouping, timezone boundaries, and daylight-saving transitions.
- Browser closed or suspended: no false zero samples; latest observation labeled accurately.
- Fresh installation, restart, repeated collection, and storage migration safety.
- Exist API success, partial failure, unauthorized response, rate limiting, offline retry, and no duplicate effects for repeat daily exports.
- No browsing URLs/titles/history, tokens, or raw tab metadata in outgoing requests or logs.

Manual Firefox testing should be described in the README, including temporary installation with `about:debugging`, observing the extension background context, checking permissions, testing restart/restore, and confirming local metrics. Real Exist writes should be separately opt-in and verified using non-sensitive test data.

## Out of scope until explicitly requested

- Multi-device aggregation or a server-side collector.
- Gmail/unread-email integration or other personal analytics collectors.
- A psychological “stress score,” statistical modeling, or alerts.
- URL/domain classification, AI categorization, or page-content inspection.
- Automated tab closing, cleanup recommendations, tab groups, or tab management.
- Full-fledged dashboards, account systems, or Mozilla Add-ons publication.

### Potential roadmap

1. Sync non-sensitive preferences via `browser.storage.sync` (with an explicit stable add-on ID).
2. Add device-specific observations to a small ingestion endpoint; aggregate daily across devices without using `storage.sync` as a database.
3. Explore optional local-only domain diversity, age distributions, stale-tab burden, and trend metrics; retain interpretability.
4. Examine correlations with Exist metrics *after* collecting sufficient history, without assuming causality.

## Initial deliverables for Codex

If beginning from an empty repository:

1. Create a minimal Firefox WebExtension with a clear README and install/development instructions.
2. Implement tab sampling, local persistence, persistent per-tab metadata, and tested daily metrics **before** adding remote reporting.
3. Implement optional Exist.io export with explicit authentication setup, attribute discovery/creation, robust retries, and a minimal settings/status UI.
4. Add automated tests and a practical manual-test checklist.
5. Document permissions, data semantics, privacy boundaries, known limitations, and how to run the project locally.

Favor a small, working, inspectable tool over an ambitious architecture. Preserve the user's ability to inspect, export, and delete locally stored observations in a future iteration without requiring data lock-in.
