# Development and testing

Tabometer uses plain JavaScript ES modules, with no framework, runtime dependencies, bundler, or build step. Commands below run from the repository root. See the [user guide](../README.md#install) for temporary installation.

## Temporary installation and restart testing

Temporary add-ons are removed when Firefox exits. Reloading through `about:debugging` is useful during development. A temporary installation does **not** establish restart persistence: use a locally packaged installation in a Firefox development profile that permits unsigned extensions for restart/restore testing. Do not weaken your everyday profile's signing requirements. Publication and signing are outside this milestone.

## Development and checks

Use Node.js 22+; no `npm install` is necessary. For asdf users, `.tool-versions` selects Node.js 24.21.0 LTS; run `asdf install` if it is not already installed:

```sh
npm test
npm run check
```

Tests use Node's built-in runner and fake browser interfaces, with no live browser/network/account writes. Coverage includes multiwindow/privacy filters, pinned/discarded tabs, inclusive inactivity thresholds, unknown/anomalous timestamps, restoration with changed IDs, copied UUIDs, fresh install/restart, alarm recreation, mode changes, event coalescing, errors/recovery, unsupported storage, local midnight, DST, timezone changes, and no false shutdown zeros. The check script validates JS syntax, manifest privacy assertions, entrypoint existence, and icon dimensions; it is **not** Mozilla's full extension validator.

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

The suite checks options controls, permissions, storage field allowlists, normal/private/popup windows, pinned/hidden/discarded tabs, repeated window transfers, exact-session close/restore, duplication, reload versus selection, mode switching, a real alarm, daily dates/offsets, retention, schema rejection/recovery, and natural event-page suspension/message wake with snapshot history. History checks also cover opt-in, multiple same-day records, once-only legacy import, reopening IndexedDB, pause/inspection/deletion, retry idempotence, transactional abort, record-cap failures, and bounded recent reads. It shortens the background idle preference only inside the disposable profile, observes suspension from Firefox's parent process, and restores a long idle timeout for other checks. An attached background debugger is not used.

An HTTP observer attributes requests to the extension during installation and lifecycle checks. A test-only GET to an ephemeral loopback server proves the observer works; its count is reset before production scenarios, which must make zero HTTP(S) requests. It neither records request URLs nor contacts external accounts. Firefox itself can make unrelated browser-service requests. The observer ends before optional browser restart, so it does not establish absence of requests during restart.

`--restart` requires [Developer Edition or Nightly for unsigned persistent installation](https://extensionworkshop.com/documentation/develop/testing-persistent-and-restart-features/). Only the disposable profile disables signature checking. This option performs an actual browser restart, checking restored UUID/first-observed time, activity metadata, local data, settings, snapshot-history records/preferences, and alarm recreation. Default runs explicitly skip this check because temporary add-ons disappear on exit. Do not point the runner at an existing profile; it intentionally has no profile argument. See the recorded results for which versions of this scenario have actually been run.

The harness uses [Mozilla Marionette](https://firefox-source-docs.mozilla.org/python/marionette_driver.html) and Firefox internals for private/hidden windows and background lifecycle observation. Those internal interfaces may change; tested versions are recorded in [test results](manual-testing.md). It enables [remote system access](https://firefox-source-docs.mozilla.org/remote/Security.html) only for the owned test process. The extension's minimum Firefox version does not imply every older release supports this harness. OS sleep/wake and visual installation/permissions review remain manual; mathematical DST/midnight boundaries remain deterministic unit tests rather than changing the host clock.

For a manual walkthrough, use the [acceptance checklist](manual-testing.md#manual-firefox-acceptance-checklist). Actual results and deferred checks are recorded in the [test log](manual-testing.md).
