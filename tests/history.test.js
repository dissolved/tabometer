import test from "node:test";
import assert from "node:assert/strict";
import {createController} from "../src/controller.js";
import {historySettings, snapshot, legacyRecords, HISTORY_SETTINGS_KEY, HISTORY_STATUS_KEY} from "../src/history.js";
import {fakeBrowser, normal} from "./helpers.js";

const now = Date.UTC(2026, 9, 12, 12);

function memoryHistory() {
  const entries = [];
  return {entries, append: async (state, value) => {
    if (!entries.length) entries.push(...legacyRecords(state));
    entries.push(structuredClone(value));
  }, inspect: async () => ({count: entries.length, recent: structuredClone(entries)}),
  clear: async () => { entries.length = 0; }};
}

test("history is opt-in; repeated same-day readings preserve distinct snapshots while daily counts replace", async () => {
  const windows = [normal([{id: 1, active: true}])];
  const api = fakeBrowser(windows);
  const history = memoryHistory();
  let timestamp = now;
  const controller = createController(api, {now: () => timestamp, uuid: api.uuid, history});
  const original = await controller.sample();
  assert.equal(history.entries.length, 0);
  await controller.updateHistory({version: 1, enabled: true});
  await controller.sample();
  windows[0].tabs.push({id: 2});
  timestamp++;
  const latest = await controller.sample();
  assert.equal(history.entries.length, 3);
  assert.equal(history.entries[0].kind, "legacy-daily");
  assert.equal(history.entries[0].tabs, null);
  assert.deepEqual(history.entries.slice(1).map(entry => entry.aggregate.total), [1, 2]);
  assert.notEqual(history.entries[1].sampleId, history.entries[2].sampleId);
  assert.equal(history.entries[1].tabs[0].selected, true);
  assert.equal(latest.deviceId, original.deviceId);
  assert.equal(latest.tabs[0].uuid, original.tabs[0].uuid);
  assert.equal(Object.keys(latest.daily).length, 1);
  assert.equal(latest.lastSample.total, 2);
  const beforeEmpty = history.entries.length;
  windows.length = 0;
  await controller.sample();
  assert.equal(history.entries.length, beforeEmpty);
  await controller.updateHistory({version: 1, enabled: false});
  windows.push(normal([{id: 1}]));
  await controller.sample();
  assert.equal(history.entries.length, beforeEmpty);
});

test("history failures leave daily collection usable and remain inspectable after recovery", async () => {
  const api = fakeBrowser([normal([{id: 1}])]);
  const history = memoryHistory();
  const controller = createController(api, {now: () => now, uuid: api.uuid, history});
  await controller.updateHistory({version: 1, enabled: true});
  const append = history.append;
  history.append = async () => { throw new Error("https://secret.invalid/quota"); };
  await assert.rejects(controller.sample());
  assert.equal(api.data.tabometer.lastSample.total, 1);
  assert.equal(api.data[HISTORY_STATUS_KEY].missedSamples, 1);
  assert.doesNotMatch(JSON.stringify(api.data[HISTORY_STATUS_KEY]), /https|secret/);
  history.append = append;
  await controller.sample();
  const result = await controller.inspectHistory();
  assert.equal(result.status.error, null);
  assert.equal(result.status.missedSamples, 1);
  assert.equal(result.status.lastFailureAt, now);
});

test("delete pauses capture without changing daily readings or identities", async () => {
  const api = fakeBrowser([normal([{id: 1}])]);
  const history = memoryHistory();
  const controller = createController(api, {now: () => now, uuid: api.uuid, history});
  await controller.updateHistory({version: 1, enabled: true});
  const before = await controller.sample();
  await controller.clearHistory();
  assert.equal(history.entries.length, 0);
  assert.equal(api.data[HISTORY_SETTINGS_KEY].enabled, false);
  assert.deepEqual(api.data.tabometer, before);
  assert.equal(api.sessionData.get(1).uuid, before.tabs[0].uuid);
  await controller.sample();
  assert.equal(history.entries.length, 0);
});

test("snapshot/import allowlists omit browsing fields and cannot invent preexisting activity history", () => {
  const extra = {url: "https://secret.invalid", title: "secret", token: "secret"};
  const state = {lastSample: {timestamp: now, date: "2026-10-12", total: 1, ...extra},
    tabs: [{uuid: "uuid", firstObservedAt: now, lastAccessedAt: null, ...extra}],
    daily: {"2026-10-11": {timestamp: now - 86400000, date: "2026-10-11", total: 4, ...extra}}};
  const current = snapshot(state, "sample");
  assert.equal(current.tabs[0].originalCreationUnknown, true);
  assert.equal(current.tabs[0].lastAccessedAt, null);
  const imported = legacyRecords(state);
  assert.equal(imported[0].tabs, null);
  assert.equal(imported[0].kind, "legacy-daily");
  assert.doesNotMatch(JSON.stringify([current, imported]), /https|secret|url|title|token/);
  assert.throws(() => historySettings({version: 999, enabled: true}));
  assert.throws(() => historySettings({version: 1, enabled: "yes"}));
});
