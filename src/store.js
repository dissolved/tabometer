import {localDay, metrics, retainDaily} from "./metrics.js";

export const STATE_KEY = "tabometer";
export const DEFAULT_SETTINGS = {mode: "hybrid", intervalMinutes: 15, retentionDays: 30};

export function settings(value) {
  if (!value || !["events", "polling", "hybrid"].includes(value.mode) ||
      !Number.isInteger(value.intervalMinutes) || value.intervalMinutes < 1 || value.intervalMinutes > 1440 ||
      !Number.isInteger(value.retentionDays) || value.retentionDays < 1 || value.retentionDays > 365) {
    throw new Error("Invalid settings");
  }
  return {mode: value.mode, intervalMinutes: value.intervalMinutes, retentionDays: value.retentionDays};
}

export async function load(api, uuid) {
  const stored = (await api.storage.local.get(STATE_KEY))[STATE_KEY];
  if (stored === undefined) {
    return {version: 1, deviceId: uuid(), settings: {...DEFAULT_SETTINGS}, daily: {}, tabs: [], lastSample: null};
  }
  // No previous schema exists. Never silently replace an unsupported/corrupt store.
  if (stored?.version !== 1 || typeof stored.deviceId !== "string" ||
      !stored.daily || typeof stored.daily !== "object" || Array.isArray(stored.daily) ||
      !Array.isArray(stored.tabs)) throw new Error("Unsupported local data");
  settings(stored.settings);
  return stored;
}

export function record(state, tabs, now, reason, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const sample = {timestamp: now, date: localDay(now), timezone,
    utcOffsetMinutes: -new Date(now).getTimezoneOffset(), reason, ...metrics(tabs, now)};
  const previous = state.daily[sample.date];
  const daily = {...state.daily};
  if (!previous || previous.timestamp <= now) daily[sample.date] = sample;
  return {...state, tabs, lastSample: sample,
    daily: retainDaily(daily, now, state.settings.retentionDays)};
}

export async function save(api, state) {
  await api.storage.local.set({[STATE_KEY]: state});
}
