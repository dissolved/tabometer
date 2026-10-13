import {DEFAULT_SETTINGS, STATE_KEY} from "./store.js";
import {historySettings, HISTORY_SETTINGS_KEY} from "./history.js";
import {storageUsage, formatBytes} from "./storage-usage.js";

const element = id => document.getElementById(id);
async function refresh() {
  const stored = await browser.storage.local.get([STATE_KEY, "tabometerStatus", HISTORY_SETTINGS_KEY]);
  const state = stored[STATE_KEY];
  for (const [key, value] of Object.entries(state?.settings ?? DEFAULT_SETTINGS)) element(key).value = value;
  element("latest").textContent = state?.lastSample ? JSON.stringify(state.lastSample, null, 2) : "No sample yet.";
  element("daily").textContent = JSON.stringify(state?.daily ?? {}, null, 2);
  element("status").textContent = JSON.stringify(stored.tabometerStatus ?? {error: null}, null, 2);
  element("history-enabled").checked = historySettings(stored[HISTORY_SETTINGS_KEY]).enabled;
  const usage = await storageUsage(navigator.storage, browser.storage.local);
  for (const [key, value] of Object.entries(usage)) {
    element(`storage-${key}`).textContent = formatBytes(value);
    element(`storage-${key}`).title = value === null ? "Unavailable" : `${value.toLocaleString()} bytes`;
  }
}
async function run(action) {
  try {
    await action();
    await refresh();
    element("message").textContent = "Done.";
  } catch {
    element("message").textContent = "Operation failed. Refresh status for details.";
  }
}
element("settings").addEventListener("submit", event => {
  event.preventDefault();
  void run(() => browser.runtime.sendMessage({type: "settings", settings: {
    mode: element("mode").value, intervalMinutes: Number(element("intervalMinutes").value),
    retentionDays: Number(element("retentionDays").value)}}));
});
element("sample").addEventListener("click", () => { void run(() => browser.runtime.sendMessage({type: "sample"})); });
element("refresh").addEventListener("click", () => { void run(refresh); });
async function inspectHistory() {
  const result = await browser.runtime.sendMessage({type: "history"});
  element("history-status").textContent = JSON.stringify({enabled: result.settings.enabled,
    count: result.count, limit: result.limit, ...result.status}, null, 2);
  element("history-recent").textContent = JSON.stringify(result.recent, null, 2);
}
element("history-settings").addEventListener("submit", event => {
  event.preventDefault();
  void run(async () => {
    await browser.runtime.sendMessage({type: "history-settings", settings: {version: 1, enabled: element("history-enabled").checked}});
    await inspectHistory();
  });
});
element("history-refresh").addEventListener("click", () => { void run(inspectHistory); });
element("history-confirm-delete").addEventListener("change", () => {
  element("history-delete").disabled = !element("history-confirm-delete").checked;
});
element("history-delete").addEventListener("click", () => {
  if (!element("history-confirm-delete").checked) return;
  void run(async () => {
    await browser.runtime.sendMessage({type: "history-clear"});
    element("history-confirm-delete").checked = false;
    element("history-delete").disabled = true;
    await inspectHistory();
  });
});
void run(refresh);
