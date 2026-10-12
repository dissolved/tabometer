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

export async function prepareWake() {
  const current = await sample();
  const tab = await browser.tabs.getCurrent();
  return {deviceId: current.deviceId, tabId: tab.id, metadata: await metadata(tab.id)};
}

export async function wake(before) {
  const result = await sample();
  assert(result.deviceId === before.deviceId, "Device identity lost on background wake");
  sameIdentity(before.metadata, await metadata(before.tabId), "Tab identity lost on background wake");
  assert((await browser.storage.local.get("tabometerStatus")).tabometerStatus.error === null, "Wake collection error");
}

export async function restartSnapshot() {
  await configure("hybrid", 15);
  const tab = await createTab();
  await sample();
  return {deviceId: (await state()).deviceId, metadata: await metadata(tab.id),
    settings: (await state()).settings, dates: Object.keys((await state()).daily)};
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
  return {activityBefore: before.metadata.lastAccessedAt, activityAfter: matching[0].lastAccessedAt};
}

export const cases = {
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
    const tabKeys = ["uuid", "firstObservedAt", "originalCreationUnknown", "lastAccessedAt", "pinned", "discarded"];
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
