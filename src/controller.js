import {observe} from "./observer.js";
import {load, record, save, settings} from "./store.js";

export const ALARM = "tabometer.sample";

export function createController(api, {now = Date.now, uuid = () => crypto.randomUUID()} = {}) {
  // One writer for samples and settings. Failed jobs do not poison the queue.
  let queue = Promise.resolve();
  const enqueue = job => {
    const result = queue.then(job);
    queue = result.catch(() => {});
    return result;
  };
  async function guarded(job) {
    try {
      const result = await job();
      await api.storage.local.set({tabometerStatus: {error: null}});
      return result;
    } catch {
      // Browser exceptions can include page URLs. Never persist/log their text.
      await api.storage.local.set({tabometerStatus: {
        error: "Operation failed. Check storage/schema support and retry; a tab may have closed during collection.",
        timestamp: now()}});
      throw new Error("Tabometer operation failed; see local status.");
    }
  }
  async function configure(state) {
    await api.alarms.clear(ALARM);
    if (state.settings.mode !== "events") {
      await api.alarms.create(ALARM, {periodInMinutes: state.settings.intervalMinutes});
    }
  }
  const sample = (reason = "manual", activations = new Map()) => enqueue(() => guarded(async () => {
    const state = await load(api, uuid);
    // Restore alarms after a restart or event-page wake; don't reset a running alarm.
    if (state.settings.mode !== "events" && !await api.alarms.get(ALARM)) await configure(state);
    const tabs = await observe(api, now(), uuid, activations, now);
    const next = tabs ? record(state, tabs, now(), reason) : state;
    await save(api, next);
    return next;
  }));
  const updateSettings = value => enqueue(() => guarded(async () => {
    const nextSettings = settings(value);
    const state = {...await load(api, uuid), settings: nextSettings};
    await save(api, state);
    await configure(state);
    return state;
  }));
  const read = () => enqueue(() => guarded(() => load(api, uuid)));
  return {sample, updateSettings, read};
}

export function register(api, controller, now = Date.now) {
  let pending = null;
  let collecting = false;
  // Coalesce bursts while a snapshot is in flight; no debounce timer that could be
  // lost when the MV3 event page unloads. Full snapshots reconcile missed events.
  async function drain() {
    if (collecting) return;
    collecting = true;
    try {
      while (pending) {
        const work = pending;
        pending = null;
        const state = await controller.read();
        if (work.force || state.settings.mode !== "polling") {
          await controller.sample(work.reason, work.activations);
        }
      }
    } catch { /* controller persists a sanitized status */ }
    finally { collecting = false; }
  }
  function request(reason, force = false, tabId) {
    pending ??= {reason, force, activations: new Map()};
    pending.reason = reason;
    pending.force ||= force;
    if (Number.isInteger(tabId)) pending.activations.set(tabId, now());
    void drain();
  }
  api.tabs.onCreated.addListener(() => request("created"));
  api.tabs.onRemoved.addListener(() => request("removed"));
  // Activation is always collected, including polling mode, to preserve fallback
  // activity timestamps if Firefox omits lastAccessed.
  api.tabs.onActivated.addListener(info => request("activated", true, info.tabId));
  api.tabs.onUpdated.addListener((_id, change) => {
    if (change.status === "complete" || "pinned" in change || "discarded" in change || "hidden" in change) {
      request("updated");
    }
  });
  api.tabs.onAttached.addListener(() => request("attached"));
  api.tabs.onDetached.addListener(() => request("detached"));
  api.tabs.onReplaced.addListener(() => request("replaced"));
  api.windows.onCreated.addListener(() => request("window-created"));
  api.windows.onRemoved.addListener(() => request("window-removed"));
  api.runtime.onStartup.addListener(() => request("startup", true));
  api.runtime.onInstalled.addListener(() => request("installed", true));
  api.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === ALARM) request("alarm", true);
  });
  api.action.onClicked.addListener(() => { void api.runtime.openOptionsPage(); });
  api.runtime.onMessage.addListener(message => {
    if (message?.type === "sample") return controller.sample();
    if (message?.type === "settings") return controller.updateSettings(message.settings);
    return undefined;
  });
  // Also reconcile extension reloads and event-page wakes. No catch-up samples.
  request("background-start", true);
}
