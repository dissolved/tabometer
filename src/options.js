import {DEFAULT_SETTINGS, STATE_KEY} from "./store.js";
import {historySettings, HISTORY_SETTINGS_KEY} from "./history.js";
import {storageUsage, formatBytes} from "./storage-usage.js";
import {localDay} from "./metrics.js";

const element = id => document.getElementById(id);
const count = value => Number.isFinite(value) ? value.toLocaleString() : "—";
function observedTime(sample) {
  // Use the recorded timezone, rather than relabeling historical readings after travel.
  const options = {dateStyle: "medium", timeStyle: "short"};
  try {
    return new Intl.DateTimeFormat(undefined, {...options, timeZone: sample.timezone}).format(sample.timestamp);
  } catch {
    return new Date(sample.timestamp).toISOString();
  }
}
function renderObservations(state) {
  const sample = state?.lastSample;
  for (const [id, key] of [["count-total", "total"], ["count-7", "inactive7Days"], ["count-30", "inactive30Days"]]) {
    element(id).textContent = count(sample?.[key]);
  }
  element("sample-time").textContent = sample
    ? `Last sampled ${observedTime(sample)} · ${sample.timezone} · ${sample.date === localDay(Date.now()) ? "Today's reading is provisional" : "Last observed reading"}`
    : "No sample yet. Take a sample to see your first observations.";
  element("coverage").textContent = sample
    ? `${count(sample.pinned)} pinned · ${count(sample.eligibleUnpinned)} unpinned · ${count(sample.unknownInactivity)} unpinned with unknown inactivity (excluded from inactive counts).`
    : "Inactivity coverage will appear after the first sample.";
  const readings = Object.entries(state?.daily ?? {}).sort(([a], [b]) => b.localeCompare(a));
  element("daily-empty").hidden = readings.length > 0;
  element("daily-table-wrap").hidden = readings.length === 0;
  const rows = readings.map(([date, reading]) => {
    const row = document.createElement("tr");
    for (const value of [date, count(reading.total), count(reading.inactive7Days), count(reading.inactive30Days),
      `${observedTime(reading)} · ${reading.timezone}`]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    if (date === localDay(Date.now())) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Provisional";
      row.firstChild.append(badge);
    }
    return row;
  });
  element("daily-rows").replaceChildren(...rows);
}
async function refresh() {
  const stored = await browser.storage.local.get([STATE_KEY, "tabometerStatus", HISTORY_SETTINGS_KEY]);
  const state = stored[STATE_KEY];
  for (const [key, value] of Object.entries(state?.settings ?? DEFAULT_SETTINGS)) element(key).value = value;
  element("latest").textContent = state?.lastSample ? JSON.stringify(state.lastSample, null, 2) : "No sample yet.";
  element("daily").textContent = JSON.stringify(state?.daily ?? {}, null, 2);
  element("status").textContent = JSON.stringify(stored.tabometerStatus ?? {error: null}, null, 2);
  renderObservations(state);
  element("collection-summary").textContent = stored.tabometerStatus?.error
    ? `Collection needs attention: ${stored.tabometerStatus.error}`
    : state?.lastSample ? "No collection errors reported." : "Waiting for the first successful sample.";
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
    element("message").dataset.error = "false";
  } catch {
    element("message").textContent = "Operation failed. Refresh status for details.";
    element("message").dataset.error = "true";
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
  element("history-summary").textContent = `${result.settings.enabled ? "Capture enabled" : "Capture paused"} · ${count(result.count)} of ${count(result.limit)} records.`
    + (result.status.error ? " History needs attention; inspect history status for details." : "")
    + (result.status.missedSamples ? ` ${count(result.status.missedSamples)} snapshots missed.` : "");
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
