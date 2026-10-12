import test from "node:test";
import assert from "node:assert/strict";
import {createController, register, ALARM} from "../src/controller.js";
import {load, settings} from "../src/store.js";
import {fakeBrowser, normal} from "./helpers.js";

const now = Date.UTC(2026, 9, 11, 12);
test("fresh install/restart, device identity, bounded daily observations, alarm recreation and mode switching", async () => {
  const windows = [normal([{id: 1}])];
  const api = fakeBrowser(windows);
  const controller = createController(api, {now: () => now, uuid: api.uuid});
  const first = await controller.sample();
  await Promise.all([controller.sample(), controller.sample()]);
  assert.equal(Object.keys(api.data.tabometer.daily).length, 1);
  api.alarmData.clear();
  const restarted = createController(api, {now: () => now + 1, uuid: api.uuid});
  const next = await restarted.sample("restart");
  assert.equal(next.deviceId, first.deviceId);
  assert.equal(next.tabs[0].uuid, first.tabs[0].uuid);
  assert.deepEqual(api.alarmData.get(ALARM), {periodInMinutes: 15});
  await restarted.updateSettings({mode: "events", intervalMinutes: 5, retentionDays: 2});
  assert.equal(api.alarmData.size, 0);
  await restarted.updateSettings({mode: "polling", intervalMinutes: 5, retentionDays: 2});
  assert.deepEqual(api.alarmData.get(ALARM), {periodInMinutes: 5});
  windows.length = 0;
  const empty = await restarted.sample("shutdown");
  assert.equal(empty.lastSample.timestamp, next.lastSample.timestamp);
});

test("unsupported/corrupt storage is preserved, failures sanitized, queue recovers", async () => {
  const api = fakeBrowser([normal([{id: 1}])]);
  const controller = createController(api, {now: () => now, uuid: api.uuid});
  api.data.tabometer = {version: 99, secret: "untouched"};
  await assert.rejects(controller.sample());
  assert.deepEqual(api.data.tabometer, {version: 99, secret: "untouched"});
  delete api.data.tabometer;
  const first = await controller.sample();
  const get = api.sessions.getTabValue;
  api.sessions.getTabValue = async () => { throw new Error("https://secret.invalid"); };
  await assert.rejects(controller.sample());
  assert.deepEqual(api.data.tabometer, first);
  assert.doesNotMatch(JSON.stringify(api.data.tabometerStatus), /secret|https/);
  api.sessions.getTabValue = get;
  await controller.sample();
  assert.equal(api.data.tabometerStatus.error, null);
  api.data.tabometer.settings.mode = "bad";
  await assert.rejects(load(api, api.uuid));
  assert.throws(() => settings({mode: "events", intervalMinutes: 0, retentionDays: 30}));
});

test("event wiring, selective page updates, coalescing and polling policy", async () => {
  const api = fakeBrowser();
  const calls = [];
  let mode = "hybrid";
  const controller = {
    read: async () => ({settings: {mode}}),
    sample: async (...args) => { calls.push(args); },
    updateSettings: async () => {}
  };
  const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };
  register(api, controller, () => now);
  await flush();
  assert.equal(calls[0][0], "background-start");
  await api.tabs.onUpdated.emit(1, {title: "secret"});
  await flush();
  assert.equal(calls.length, 1);
  await api.tabs.onUpdated.emit(1, {status: "complete"});
  await flush();
  assert.equal(calls.at(-1)[0], "updated");
  calls.length = 0;
  mode = "polling";
  await api.tabs.onCreated.emit({id: 1});
  await flush();
  assert.equal(calls.length, 0);
  await api.tabs.onActivated.emit({tabId: 1});
  await flush();
  assert.equal(calls[0][1].get(1), now);
  await api.alarms.onAlarm.emit({name: ALARM});
  await flush();
  assert.equal(calls.at(-1)[0], "alarm");
  mode = "events";
  calls.length = 0;
  for (let i = 0; i < 100; i++) void api.tabs.onRemoved.emit(i);
  await flush();
  assert.ok(calls.length > 0 && calls.length <= 2);
});

test("failed storage write keeps previous reading and a later collection recovers", async () => {
  const windows = [normal([{id: 1}])];
  const api = fakeBrowser(windows);
  let timestamp = now;
  const controller = createController(api, {now: () => timestamp, uuid: api.uuid});
  const first = await controller.sample();
  const set = api.storage.local.set;
  api.storage.local.set = async value => {
    if (value.tabometer) throw new Error("quota or disk failure");
    return set(value);
  };
  timestamp += 86_400_000 * 5;
  windows[0].tabs.push({id: 2});
  await assert.rejects(controller.sample());
  assert.deepEqual(api.data.tabometer, first);
  api.storage.local.set = set;
  const next = await controller.sample();
  assert.equal(next.lastSample.total, 2);
  assert.equal(Object.keys(next.daily).length, 2); // no fabricated days in the gap
  await controller.updateSettings({mode: "hybrid", intervalMinutes: 15, retentionDays: 2});
  await controller.sample();
  assert.equal(Object.keys(api.data.tabometer.daily).length, 1);
});
