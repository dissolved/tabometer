// Copied into a test-only package; the production manifest and source are unchanged.
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const metadata = id => browser.sessions.getTabValue(id, "tabometer.identity.v1");
const state = async () => (await browser.storage.local.get("tabometer")).tabometer;
const sample = () => browser.runtime.sendMessage({type: "sample"});
const fixture = browser.runtime.getURL("integration/fixture.html");
const configure = (mode, intervalMinutes = 15, retentionDays = 30) =>
  browser.runtime.sendMessage({type: "settings", settings: {mode, intervalMinutes, retentionDays}});

async function eventually(check, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  do {
    if (await check()) return;
    await pause(100);
  } while (Date.now() < deadline);
  throw new Error("Timed out: " + message);
}

async function createTab(properties = {}) {
  const tab = await browser.tabs.create({url: fixture, active: false, ...properties});
  await eventually(async () => (await browser.tabs.get(tab.id)).status === "complete", "fixture load");
  return tab;
}

function sameIdentity(before, after, message) {
  assert(before?.uuid === after?.uuid && before?.firstObservedAt === after?.firstObservedAt,
    message + ": " + JSON.stringify({before, after}));
}

async function checkCounts() {
  const windows = await browser.windows.getAll({populate: true, windowTypes: ["normal"]});
  const tabs = windows.filter(win => !win.incognito).flatMap(win => win.tabs);
  const reading = (await sample()).lastSample;
  assert(reading.total === tabs.length, "Normal-window count mismatch");
  assert(reading.pinned === tabs.filter(tab => tab.pinned).length, "Pinned count mismatch");
  assert(reading.eligibleUnpinned + reading.pinned === reading.total, "Coverage mismatch");
  return reading;
}

export async function externalWindowCounts(expected) {
  assert((await checkCounts()).total === expected, "Private/popup window affected total");
}

export async function prepareWake(captureHistory = false) {
  if (captureHistory) await browser.runtime.sendMessage({type: "history-settings", settings: {version: 1, enabled: true}});
  const current = await sample();
  const tab = await browser.tabs.getCurrent();
  const history = captureHistory ? await browser.runtime.sendMessage({type: "history"}) : null;
  return {deviceId: current.deviceId, tabId: tab.id, metadata: await metadata(tab.id),
    historySampleId: history?.recent[0].sampleId};
}

export async function wake(before) {
  const result = await sample();
  assert(result.deviceId === before.deviceId, "Device identity lost on background wake");
  sameIdentity(before.metadata, await metadata(before.tabId), "Tab identity lost on background wake");
  assert((await browser.storage.local.get("tabometerStatus")).tabometerStatus.error === null, "Wake collection error");
  if (before.historySampleId) {
    const history = await browser.runtime.sendMessage({type: "history"});
    assert(history.settings.enabled, "History preference lost on wake");
    assert(history.recent.some(item => item.sampleId === before.historySampleId), "History lost on background wake");
    await browser.runtime.sendMessage({type: "history-clear"});
    // Test setup only: restore an uninitialized history database/preferences so
    // later scenarios can exercise the first-enable legacy import independently.
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase("tabometer-history");
      request.onsuccess = resolve;
      request.onerror = reject;
    });
    await browser.storage.local.remove(["tabometerHistorySettings", "tabometerHistoryStatus"]);
  }
}

export async function restartSnapshot() {
  await configure("hybrid", 15);
  await browser.runtime.sendMessage({type: "history-settings", settings: {version: 1, enabled: true}});
  const tab = await createTab();
  await sample();
  return {deviceId: (await state()).deviceId, metadata: await metadata(tab.id),
    settings: (await state()).settings, dates: Object.keys((await state()).daily),
    historySampleId: (await browser.runtime.sendMessage({type: "history"})).recent[0].sampleId};
}

export async function verifyRestart(before) {
  const current = await sample();
  assert(current.deviceId === before.deviceId, "Device identity changed on restart");
  assert(JSON.stringify(current.settings) === JSON.stringify(before.settings), "Settings changed on restart");
  assert(before.dates.every(date => date in current.daily), "Daily observations lost on restart");
  const matching = current.tabs.filter(tab => tab.uuid === before.metadata.uuid);
  assert(matching.length === 1, "Restored identity missing or duplicated after restart");
  sameIdentity(before.metadata, matching[0], "First-observed time changed on restart");
  if (before.metadata.lastAccessedAt !== null) {
    assert(matching[0].lastAccessedAt >= before.metadata.lastAccessedAt, "Known activity lost on restart");
  }
  assert(await browser.alarms.get("tabometer.sample"), "Sampling alarm missing after restart");
  const history = await browser.runtime.sendMessage({type: "history"});
  assert(history.settings.enabled, "History setting lost on restart");
  assert(history.recent.some(item => item.sampleId === before.historySampleId), "History lost on browser restart");
  return {activityBefore: before.metadata.lastAccessedAt, activityAfter: matching[0].lastAccessedAt};
}

export const cases = {
  async "storage estimates displayed above history and refreshed with status"() {
    document.getElementById("message").textContent = "";
    document.getElementById("refresh").click();
    await eventually(() => document.getElementById("message").textContent === "Done.", "storage refresh");
    const {formatBytes} = await import("../src/storage-usage.js");
    const estimate = await navigator.storage.estimate();
    const quota = document.getElementById("storage-quota");
    assert(Number.isFinite(estimate.quota) && estimate.quota > 0, "No usable native quota estimate");
    assert(quota.textContent === formatBytes(estimate.quota), "Quota not displayed from native API");
    for (const id of ["storage-usage", "storage-local"]) {
      const item = document.getElementById(id);
      assert(item.textContent !== "Checking…" && item.textContent !== "Unavailable", "Missing storage measurement: " + id);
      assert(item.title.endsWith(" bytes"), "Exact reported bytes missing: " + id);
    }
    const localSize = await browser.storage.local.getBytesInUse(null);
    assert(localSize > 0, "Missing local daily data/settings size");
    const position = document.getElementById("storage-usage").compareDocumentPosition(document.getElementById("history-settings"));
    assert(position & Node.DOCUMENT_POSITION_FOLLOWING, "Storage appears below history");
  },
  async "fresh installation and options UI"() {
    const current = await sample();
    assert(current.version === 1 && current.deviceId.length === 36, "Missing installation identity");
    assert(current.lastSample.total >= 1, "Options tab should count");
    assert(current.settings.mode === "hybrid" && current.settings.intervalMinutes === 15 &&
      current.settings.retentionDays === 30, "Incorrect installation defaults");
    document.getElementById("message").textContent = "";
    document.getElementById("refresh").click();
    await eventually(() => document.getElementById("message").textContent === "Done.", "UI refresh");
    assert(JSON.parse(document.getElementById("latest").textContent).total === current.lastSample.total, "UI does not display sample");
    assert(document.getElementById("count-total").textContent === current.lastSample.total.toLocaleString(), "Summary count differs from sample");
    assert(document.getElementById("count-7").textContent === current.lastSample.inactive7Days.toLocaleString(), "Seven-day summary differs from sample");
    assert(document.getElementById("count-30").textContent === current.lastSample.inactive30Days.toLocaleString(), "Thirty-day summary differs from sample");
    assert(document.querySelectorAll("#daily-rows tr").length === Object.keys(current.daily).length, "Daily table omits readings");
    assert(document.querySelector("#daily-rows .badge")?.textContent === "Provisional", "Today's reading is not labeled provisional");
    const icon = document.querySelector(".brand img");
    assert(icon.complete && icon.naturalWidth === 128, "Page icon failed to load");
    document.getElementById("mode").value = "events";
    document.getElementById("settings").requestSubmit();
    await eventually(async () => (await state()).settings.mode === "events", "UI saves settings");
    document.getElementById("message").textContent = "";
    document.getElementById("sample").click();
    await eventually(() => document.getElementById("message").textContent === "Done.", "UI samples");
    await configure("hybrid");
    assert((await browser.storage.local.get("tabometerStatus")).tabometerStatus.error === null, "Collection error");
  },

  async "runtime permissions and stored-data allowlists"() {
    const permissions = await browser.permissions.getAll();
    assert(JSON.stringify(permissions.permissions.sort()) === JSON.stringify(["alarms", "sessions", "storage"]), "Unexpected permissions");
    assert(permissions.origins.length === 0, "Unexpected host permissions");
    assert(!await browser.extension.isAllowedIncognitoAccess(), "Private access enabled");
    const current = await sample();
    const tabKeys = ["uuid", "firstObservedAt", "originalCreationUnknown", "lastAccessedAt", "pinned", "discarded", "selected"];
    assert(current.tabs.every(tab => Object.keys(tab).every(key => tabKeys.includes(key))), "Unexpected stored tab fields");
    assert(current.tabs.every(tab => tab.originalCreationUnknown === true), "Creation time inferred");
    const aggregateKeys = ["timestamp", "date", "timezone", "utcOffsetMinutes", "reason", "total", "pinned",
      "inactive7Days", "inactive30Days", "unknownInactivity", "eligibleUnpinned"];
    assert(Object.values(current.daily).every(reading => Object.keys(reading).every(key => aggregateKeys.includes(key))), "Unexpected aggregate fields");
    const sync = await browser.storage.sync.get();
    assert(Object.keys(sync).length === 0, "Data written to sync storage");
  },

  async "normal windows, pinning, discard and identity on moves"() {
    const baseline = await checkCounts();
    const target = await createTab();
    await eventually(async () => (await state()).lastSample.total === baseline.total + 1, "created event");
    const before = await metadata(target.id);
    const marker = crypto.randomUUID();
    await browser.sessions.setTabValue(target.id, "integration.moveMarker", marker);
    const moved = await browser.windows.create({tabId: target.id});
    assert((await checkCounts()).total === baseline.total + 1, "Moving double-counted tab");
    const markerSurvived = await browser.sessions.getTabValue(target.id, "integration.moveMarker") === marker;
    sameIdentity(before, await metadata(target.id), `Move lost identity (independent marker survived: ${markerSurvived})`);
    await browser.tabs.update(target.id, {pinned: true});
    assert((await checkCounts()).pinned === baseline.pinned + 1, "Pin not counted");
    await browser.tabs.update(target.id, {pinned: false});
    assert((await checkCounts()).pinned === baseline.pinned, "Unpin not counted");
    const companion = await createTab({windowId: moved.id, active: true});
    await browser.tabs.discard(target.id);
    assert((await browser.tabs.get(target.id)).discarded, "Firefox did not discard fixture");
    assert((await checkCounts()).total === baseline.total + 2, "Discarded tab excluded");
    assert((await state()).tabs.find(tab => tab.uuid === before.uuid).discarded, "Discard state missing");
    await browser.tabs.remove(companion.id);
    await browser.windows.remove(moved.id);
    assert((await checkCounts()).total === baseline.total, "Closed window still counted");
  },

  async "popup-window exclusion"() {
    const baseline = await checkCounts();
    const popup = await browser.windows.create({type: "popup", url: fixture});
    try {
      assert((await checkCounts()).total === baseline.total, "Popup counted as normal window");
    } finally {
      await browser.windows.remove(popup.id);
    }
  },

  async "repeated window transfers preserve identity"() {
    const originalWindow = (await browser.tabs.getCurrent()).windowId;
    const target = await createTab();
    await sample();
    const before = await metadata(target.id);
    const marker = crypto.randomUUID();
    await browser.sessions.setTabValue(target.id, "integration.moveMarker", marker);
    for (let index = 0; index < 10; index++) {
      await browser.windows.create({tabId: target.id});
      await sample();
      sameIdentity(before, await metadata(target.id), `Window transfer ${index}`);
      await browser.tabs.move(target.id, {windowId: originalWindow, index: -1});
      await sample();
      sameIdentity(before, await metadata(target.id), `Return transfer ${index}`);
      assert(await browser.sessions.getTabValue(target.id, "integration.moveMarker") === marker, "Move lost independent session marker");
    }
    await browser.tabs.remove(target.id);
  },

  async "exact-session restore and duplicate identities"() {
    const tab = await createTab();
    await sample();
    const before = await metadata(tab.id);
    const marker = crypto.randomUUID();
    await browser.sessions.setTabValue(tab.id, "integration.marker", marker);
    const known = new Set((await browser.sessions.getRecentlyClosed()).map(entry => entry.tab?.sessionId));
    await browser.tabs.remove(tab.id);
    let entries;
    await eventually(async () => {
      entries = (await browser.sessions.getRecentlyClosed()).filter(entry => entry.tab && !known.has(entry.tab.sessionId));
      return entries.length === 1;
    }, "specific closed session");
    const restored = (await browser.sessions.restore(entries[0].tab.sessionId)).tab;
    assert(restored.id !== tab.id, "Restored browser ID unexpectedly unchanged");
    await sample();
    sameIdentity(before, await metadata(restored.id), "Restore lost identity");
    assert(await browser.sessions.getTabValue(restored.id, "integration.marker") === marker, "Firefox lost marker");
    const duplicate = await browser.tabs.duplicate(restored.id);
    await sample();
    assert((await metadata(duplicate.id)).uuid !== (await metadata(restored.id)).uuid, "Duplicate shared UUID");
    const uuids = (await state()).tabs.map(tab => tab.uuid);
    assert(uuids.length === new Set(uuids).size, "Duplicate UUIDs in snapshot");
    await browser.tabs.remove([restored.id, duplicate.id]);
  },

  async "background reload versus tab selection activity"() {
    const tab = await createTab();
    await sample();
    const before = await metadata(tab.id);
    await browser.tabs.reload(tab.id);
    await eventually(async () => (await browser.tabs.get(tab.id)).status === "complete", "reload completion");
    await sample();
    const afterReload = await metadata(tab.id);
    sameIdentity(before, afterReload, "Reload lost identity");
    assert(before.lastAccessedAt === afterReload.lastAccessedAt, "Background reload reset activity");
    await pause(50);
    await browser.tabs.update(tab.id, {active: true});
    await sample();
    assert((await metadata(tab.id)).lastAccessedAt > afterReload.lastAccessedAt, "Selection did not advance activity");
    await browser.tabs.remove(tab.id);
  },

  async "events-only and polling trigger policies"() {
    await configure("events");
    assert(!await browser.alarms.get("tabometer.sample"), "Events mode retained alarm");
    const baseline = await sample();
    await pause(500);
    assert((await state()).lastSample.timestamp === baseline.lastSample.timestamp, "Quiet events mode sampled");
    const eventTab = await createTab();
    await eventually(async () => (await state()).lastSample.total === baseline.lastSample.total + 1, "events mode creation");
    await browser.tabs.remove(eventTab.id);
    await sample();
    await pause(200); // drain preceding removal/load events before switching modes
    await configure("polling", 1440);
    const pollingBaseline = await sample();
    const pollTab = await createTab();
    await pause(500);
    assert((await state()).lastSample.timestamp === pollingBaseline.lastSample.timestamp, "Polling sampled background creation");
    assert((await sample()).lastSample.total === pollingBaseline.lastSample.total + 1, "Manual reconciliation missed new tab");
    const beforeSelection = (await state()).lastSample.timestamp;
    await browser.tabs.update(pollTab.id, {active: true});
    await eventually(async () => (await state()).lastSample.timestamp > beforeSelection, "selection fallback in polling mode");
    await browser.tabs.remove(pollTab.id);
    await configure("hybrid");
  },

  async "daily dates, retention and unsupported-schema recovery"() {
    await configure("polling", 1440, 2);
    const saved = await sample();
    const today = new Date();
    const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    assert(saved.lastSample.date === localDate, "Daily key is not local date");
    assert(saved.lastSample.utcOffsetMinutes === -today.getTimezoneOffset(), "Wrong UTC offset");
    assert(saved.lastSample.timezone === Intl.DateTimeFormat().resolvedOptions().timeZone, "Wrong timezone");
    const previous = structuredClone(saved);
    previous.daily["2000-01-01"] = {...saved.lastSample, date: "2000-01-01", timestamp: 946684800000};
    await browser.storage.local.set({tabometer: previous});
    const pruned = await sample();
    assert(!("2000-01-01" in pruned.daily), "Retention did not prune seeded old reading");
    assert(Object.keys(pruned.daily).length === 1, "Repeated samples created extra daily entries");
    const unsupported = {...pruned, version: 999};
    await browser.storage.local.set({tabometer: unsupported});
    let failed = false;
    try { await sample(); } catch { failed = true; }
    assert(failed, "Unsupported schema accepted");
    assert((await state()).version === 999, "Unsupported data overwritten");
    assert((await browser.storage.local.get("tabometerStatus")).tabometerStatus.error, "Failure status missing");
    await browser.storage.local.set({tabometer: pruned});
    await sample();
    assert((await browser.storage.local.get("tabometerStatus")).tabometerStatus.error === null, "Recovery did not clear status");
    await configure("hybrid");
  },

  async "snapshot history opt-in, import, persistence, pause and deletion UI"() {
    const before = await sample();
    assert((await browser.runtime.sendMessage({type: "history"})).count === 0, "History captured before opt-in");
    document.getElementById("history-enabled").checked = true;
    document.getElementById("history-settings").requestSubmit();
    await eventually(async () => (await browser.storage.local.get("tabometerHistorySettings")).tabometerHistorySettings?.enabled,
      "history opt-in saved");
    await sample();
    const target = await createTab();
    await sample();
    const history = await browser.runtime.sendMessage({type: "history"});
    assert(history.count >= Object.keys(before.daily).length + 2, "Snapshots replaced within same day");
    assert(history.recent.filter(item => item.kind === "legacy-daily").length === Object.keys(before.daily).length,
      "Legacy readings missing or imported twice");
    assert(history.recent.filter(item => item.kind === "legacy-daily").every(item => item.tabs === null), "Invented tab history");
    assert(history.recent.filter(item => item.kind === "snapshot").some(item =>
      item.tabs.some(tab => tab.uuid === before.tabs[0].uuid)), "Snapshot identity changed");
    const {createHistoryStore} = await import("../src/history.js");
    assert((await createHistoryStore().inspect()).count === history.count, "Reopened database lost history");
    await browser.runtime.sendMessage({type: "history-settings", settings: {version: 1, enabled: false}});
    const paused = await browser.runtime.sendMessage({type: "history"});
    await sample();
    assert((await browser.runtime.sendMessage({type: "history"})).count === paused.count, "Paused capture appended history");
    document.getElementById("history-refresh").click();
    await eventually(() => document.getElementById("history-recent").textContent.includes('"snapshot"'), "history inspector");
    const daily = await state();
    document.getElementById("history-confirm-delete").checked = true;
    document.getElementById("history-confirm-delete").dispatchEvent(new Event("change"));
    document.getElementById("history-delete").click();
    await eventually(async () => (await browser.runtime.sendMessage({type: "history"})).count === 0, "history deletion");
    assert((await state()).deviceId === daily.deviceId, "Deletion reset installation identity");
    assert(JSON.stringify((await state()).daily) === JSON.stringify(daily.daily), "Deletion changed daily counts");
    await browser.runtime.sendMessage({type: "history-settings", settings: {version: 1, enabled: true}});
    await sample();
    const resumed = await browser.runtime.sendMessage({type: "history"});
    assert(resumed.recent.every(item => item.kind === "snapshot"), "Deleted legacy readings were reimported");
    await browser.runtime.sendMessage({type: "history-clear"});
    await browser.tabs.remove(target.id);
  },

  async "IndexedDB import/append atomicity, idempotence and cap failures"() {
    const {createHistoryStore, snapshot} = await import("../src/history.js");
    const source = await sample();
    const name = "integration-history-" + crypto.randomUUID();
    const store = createHistoryStore(indexedDB, name);
    const record = snapshot(source, "first");
    try {
      // Force a unique-index violation *after* enqueueing the legacy import.
      const colliding = {...record, sampleId: "legacy:" + Object.keys(source.daily)[0]};
      let rejected = false;
      try { await store.append(source, colliding); } catch { rejected = true; }
      assert(rejected, "Constraint failure committed");
      assert((await store.inspect()).count === 0, "Aborted import left records");
      await store.append(source, record);
      const first = await store.inspect();
      await store.append(source, record);
      assert((await store.inspect()).count === first.count, "Retry duplicated snapshot/import");
      const capped = createHistoryStore(indexedDB, name, first.count);
      rejected = false;
      try { await capped.append(source, snapshot(source, "over-cap")); } catch { rejected = true; }
      assert(rejected, "Record cap ignored");
      assert((await store.inspect()).count === first.count, "Cap failure corrupted history");
      for (let index = 0; index < 25; index++) await store.append(source, snapshot(source, "extra-" + index));
      const bounded = await store.inspect();
      assert(bounded.recent.length === 20 && bounded.recent[0].sampleId === "extra-24", "Unbounded or unordered history read");
      await store.clear(source.deviceId);
      await store.append(source, snapshot(source, "after-clear"));
      assert((await store.inspect()).count === 1, "Deletion reimported legacy history");
    } finally {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = resolve;
        request.onerror = reject;
      });
    }
  },

  async "real one-minute alarm without synthetic clock"() {
    await configure("hybrid", 1);
    const baseline = await sample();
    await eventually(async () => {
      const latest = (await state()).lastSample;
      return latest.timestamp > baseline.lastSample.timestamp && latest.reason === "alarm";
    }, "one-minute Firefox alarm", 90000);
    assert((await state()).lastSample.total === baseline.lastSample.total, "Quiet alarm changed total");
    await configure("hybrid");
  }
};
