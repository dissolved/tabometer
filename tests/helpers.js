import {randomUUID} from "node:crypto";

export function fakeBrowser(windows = []) {
  const data = {};
  const sessions = new Map();
  const alarms = new Map();
  const event = () => ({listeners: [], addListener(fn) { this.listeners.push(fn); },
    emit(...args) { return Promise.all(this.listeners.map(fn => fn(...args))); }});
  return {
    data, sessionData: sessions, alarmData: alarms,
    windows: {getAll: async () => structuredClone(windows), onCreated: event(), onRemoved: event()},
    sessions: {
      getTabValue: async id => structuredClone(sessions.get(id)),
      setTabValue: async (id, _key, value) => { sessions.set(id, structuredClone(value)); }
    },
    storage: {local: {
      get: async key => Object.fromEntries((Array.isArray(key) ? key : [key]).map(k => [k, structuredClone(data[k])])),
      set: async value => { Object.assign(data, structuredClone(value)); }
    }},
    alarms: {get: async name => alarms.get(name), clear: async name => alarms.delete(name),
      create: async (name, value) => { alarms.set(name, value); }, onAlarm: event()},
    tabs: Object.fromEntries(["onCreated", "onRemoved", "onActivated", "onUpdated", "onAttached", "onDetached", "onReplaced"].map(k => [k, event()])),
    runtime: {onStartup: event(), onInstalled: event(), onMessage: event(), openOptionsPage: async () => {}},
    action: {onClicked: event()},
    uuid: randomUUID
  };
}

export function normal(tabs, id = 1) { return {id, type: "normal", incognito: false, tabs}; }
