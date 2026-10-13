// Native IndexedDB transactions commit the import marker and records together.
// https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction
export const HISTORY_SETTINGS_KEY = "tabometerHistorySettings";
export const HISTORY_STATUS_KEY = "tabometerHistoryStatus";
export const HISTORY_LIMIT = 100_000;
export const HISTORY_DEFAULTS = {version: 1, enabled: false};

export function historySettings(value = HISTORY_DEFAULTS) {
  if (value?.version !== 1 || typeof value.enabled !== "boolean") throw new Error("Unsupported history settings");
  return {version: 1, enabled: value.enabled};
}

// Separate allowlists keep future browser/API fields out of the history store.
export function aggregate(value) {
  return Object.fromEntries(["timestamp", "date", "timezone", "utcOffsetMinutes", "reason", "total", "pinned",
    "inactive7Days", "inactive30Days", "unknownInactivity", "eligibleUnpinned"].map(key => [key, value[key]]));
}

export function snapshot(state, sampleId) {
  return {version: 1, sampleId, kind: "snapshot", aggregate: aggregate(state.lastSample),
    tabs: state.tabs.map(tab => ({uuid: tab.uuid, firstObservedAt: tab.firstObservedAt,
      originalCreationUnknown: true, lastAccessedAt: tab.lastAccessedAt,
      pinned: Boolean(tab.pinned), discarded: Boolean(tab.discarded), selected: Boolean(tab.selected)}))};
}

export function legacyRecords(state) {
  // Import representative daily readings, not fabricated intraday/tab history.
  return Object.entries(state.daily).sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({
    version: 1, sampleId: `legacy:${date}`, kind: "legacy-daily", aggregate: aggregate(value), tabs: null
  }));
}

export function createHistoryStore(factory = globalThis.indexedDB, name = "tabometer-history", limit = HISTORY_LIMIT) {
  async function open() {
    return new Promise((resolve, reject) => {
      let blocked = false;
      const request = factory.open(name, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        const records = db.createObjectStore("records", {keyPath: "sequence", autoIncrement: true});
        records.createIndex("sampleId", "sampleId", {unique: true});
        records.createIndex("date", "aggregate.date");
        db.createObjectStore("meta");
      };
      request.onerror = () => reject(new Error("History database unavailable"));
      request.onblocked = () => { blocked = true; reject(new Error("History database blocked")); };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) { db.close(); return; }
        db.onversionchange = () => db.close();
        resolve(db);
      };
    });
  }

  async function transaction(mode, action) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(["records", "meta"], mode);
        let result;
        let failure;
        const fail = error => { failure = error; tx.abort(); };
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(failure ?? new Error("History transaction failed"));
        // Only IDB callbacks enqueue more IDB requests; never await browser APIs
        // inside a transaction, which can cause premature auto-commit.
        try { action(tx, value => { result = value; }, fail); }
        catch (error) { fail(error); }
      });
    } finally { db.close(); }
  }

  return {
    append(state, record) {
      return transaction("readwrite", (tx, done, fail) => {
        const records = tx.objectStore("records");
        const meta = tx.objectStore("meta");
        const imported = meta.get("import");
        imported.onsuccess = () => {
          if (imported.result && (imported.result.version !== 1 || imported.result.deviceId !== state.deviceId)) {
            fail(new Error("History installation mismatch"));
            return;
          }
          const existing = records.index("sampleId").get(record.sampleId);
          existing.onsuccess = () => {
            if (existing.result) { done(existing.result.sequence); return; }
            const imports = imported.result ? [] : legacyRecords(state);
            const count = records.count();
            count.onsuccess = () => {
              if (count.result + imports.length + 1 > limit) { fail(new Error("History record limit reached")); return; }
              for (const entry of imports) records.add(entry);
              if (!imported.result) meta.put({version: 1, deviceId: state.deviceId}, "import");
              const added = records.add(record);
              added.onsuccess = () => done(added.result);
            };
          };
        };
      });
    },
    inspect() {
      return transaction("readonly", (tx, done) => {
        const store = tx.objectStore("records");
        const result = {version: 1, count: 0, limit, recent: []};
        const count = store.count();
        count.onsuccess = () => { result.count = count.result; };
        // Bound reads and message/UI size even when the store reaches its cap.
        const cursor = store.openCursor(null, "prev");
        cursor.onsuccess = () => {
          if (!cursor.result || result.recent.length === 20) { done(result); return; }
          result.recent.push(cursor.result.value);
          cursor.result.continue();
        };
      });
    },
    clear(deviceId) {
      return transaction("readwrite", tx => {
        tx.objectStore("records").clear();
        // Keep a tombstone so deletion cannot reimport the legacy daily records.
        tx.objectStore("meta").put({version: 1, deviceId}, "import");
      });
    }
  };
}
