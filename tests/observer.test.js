import test from "node:test";
import assert from "node:assert/strict";
import {observe, SESSION_KEY} from "../src/observer.js";
import {DAY, metrics} from "../src/metrics.js";
import {fakeBrowser, normal} from "./helpers.js";

const now = Date.UTC(2026, 9, 11);
test("multiple normal windows, discarded/pinned/hidden tabs, no browsing content retained", async () => {
  const api = fakeBrowser([normal([{id: 1, pinned: true, url: "https://private.invalid", title: "secret"},
    {id: 2, discarded: true, hidden: true, lastAccessed: now - 30 * DAY}]),
  normal([{id: 3, lastAccessed: now - 7 * DAY}], 2),
  {type: "normal", incognito: true, tabs: [{id: 4}]}, {type: "popup", tabs: [{id: 5}]}]);
  const tabs = await observe(api, now, api.uuid);
  assert.equal(tabs.length, 3);
  assert.equal(metrics(tabs, now).inactive7Days, 2);
  assert.equal(tabs[0].firstObservedAt, now);
  assert.equal(tabs[0].originalCreationUnknown, true);
  assert.equal(tabs[0].lastAccessedAt, null);
  assert.equal(api.sessionData.size, 3);
  assert.doesNotMatch(JSON.stringify(tabs), /private|secret|https|title|url|"id"/i);
});

test("session identity follows restored tab with a new browser id, old activity survives missing/backward values", async () => {
  const windows = [normal([{id: 1, lastAccessed: now - 30 * DAY}])];
  const api = fakeBrowser(windows);
  const [original] = await observe(api, now, api.uuid);
  const value = await api.sessions.getTabValue(1, SESSION_KEY);
  windows[0].tabs = [{id: 99, lastAccessed: 0}];
  await api.sessions.setTabValue(99, SESSION_KEY, value);
  const [restored] = await observe(api, now + 1, api.uuid);
  assert.deepEqual(restored, original);
  const [selected] = await observe(api, now + 2, api.uuid, new Map([[99, now + 2]]));
  assert.equal(selected.uuid, original.uuid);
  assert.equal(selected.lastAccessedAt, now + 2);
  assert.equal(metrics([selected], now + 2).inactive7Days, 0);
});

test("invalid timestamps stay unknown; duplicate session UUIDs are repaired", async () => {
  const windows = [normal([{id: 1, lastAccessed: now + 100}, {id: 2, lastAccessed: -1}])];
  const api = fakeBrowser(windows);
  const first = await observe(api, now, api.uuid);
  await api.sessions.setTabValue(2, SESSION_KEY, api.sessionData.get(1));
  const next = await observe(api, now, api.uuid);
  assert.equal(next[0].uuid, first[0].uuid);
  assert.notEqual(next[0].uuid, next[1].uuid);
  assert.equal(metrics(next, now).unknownInactivity, 2);
});

test("no normal tabs during shutdown produces no sample; session failure rejects whole snapshot", async () => {
  const api = fakeBrowser([]);
  assert.equal(await observe(api, now, api.uuid), null);
  api.windows.getAll = async () => [normal([{id: 1}])];
  api.sessions.getTabValue = async () => { throw new Error("tab disappeared"); };
  await assert.rejects(observe(api, now, api.uuid));
});

test("validation uses enumeration completion; near-epoch timestamps remain unknown", async () => {
  const api = fakeBrowser([normal([{id: 1, lastAccessed: now + 5}, {id: 2, lastAccessed: 1}])]);
  const tabs = await observe(api, now, api.uuid, new Map(), () => now + 10);
  assert.equal(tabs[0].lastAccessedAt, now + 5);
  assert.equal(tabs[1].lastAccessedAt, null);
});
