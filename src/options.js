import {DEFAULT_SETTINGS, STATE_KEY} from "./store.js";

const element = id => document.getElementById(id);
async function refresh() {
  const stored = await browser.storage.local.get([STATE_KEY, "tabometerStatus"]);
  const state = stored[STATE_KEY];
  for (const [key, value] of Object.entries(state?.settings ?? DEFAULT_SETTINGS)) element(key).value = value;
  element("latest").textContent = state?.lastSample ? JSON.stringify(state.lastSample, null, 2) : "No sample yet.";
  element("daily").textContent = JSON.stringify(state?.daily ?? {}, null, 2);
  element("status").textContent = JSON.stringify(stored.tabometerStatus ?? {error: null}, null, 2);
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
void run(refresh);
