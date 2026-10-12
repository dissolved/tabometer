import {validTime} from "./metrics.js";

export const SESSION_KEY = "tabometer.identity.v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function identity(value, now, uuid) {
  if (value?.version === 1 && UUID.test(value.uuid) && validTime(value.firstObservedAt, now)) {
    return {version: 1, uuid: value.uuid, firstObservedAt: value.firstObservedAt,
      lastAccessedAt: validTime(value.lastAccessedAt, now) ? value.lastAccessedAt : null};
  }
  return {version: 1, uuid: uuid(), firstObservedAt: now, lastAccessedAt: null};
}

export async function observe(api, now, uuid, activations = new Map(), clock = () => now, identities = new Map()) {
  const windows = await api.windows.getAll({populate: true, windowTypes: ["normal"]});
  // Selected-tab lastAccessed can be generated during enumeration. Validate
  // against its completion time, not the instant before the asynchronous query.
  now = clock();
  const normal = windows.filter(window => window.type === "normal" && !window.incognito);
  // During last-window shutdown, an empty enumeration is not a measured zero.
  if (!normal.length) return null;
  const tabs = [];
  const seenIds = new Set();
  const seenUUIDs = new Set();
  for (const window of normal) {
    for (const tab of window.tabs ?? []) {
      if (tab.incognito || !Number.isInteger(tab.id) || tab.id < 0 || seenIds.has(tab.id)) continue;
      seenIds.add(tab.id);
      const saved = await api.sessions.getTabValue(tab.id, SESSION_KEY);
      // During window adoption Firefox can briefly return no value before
      // restoring the tab's session data. Bridge that gap using the same live
      // tab ID, never a URL/title match. The controller forgets closed IDs.
      let metadata = identity(saved ?? identities.get(tab.id), now, uuid);
      // Firefox duplication can copy session values. Concurrent tabs need distinct identities.
      if (seenUUIDs.has(metadata.uuid)) metadata = identity(null, now, uuid);
      seenUUIDs.add(metadata.uuid);
      const candidates = [metadata.lastAccessedAt, tab.lastAccessed, activations.get(tab.id)]
        .filter(time => validTime(time, now));
      metadata.lastAccessedAt = candidates.length ? Math.max(...candidates) : null;
      await api.sessions.setTabValue(tab.id, SESSION_KEY, metadata);
      identities.set(tab.id, metadata);
      // Explicit allowlist: never spread a browser Tab object into stored data.
      tabs.push({uuid: metadata.uuid, firstObservedAt: metadata.firstObservedAt,
        originalCreationUnknown: true, lastAccessedAt: metadata.lastAccessedAt,
        pinned: Boolean(tab.pinned), discarded: Boolean(tab.discarded)});
    }
  }
  return tabs.length ? tabs : null;
}
