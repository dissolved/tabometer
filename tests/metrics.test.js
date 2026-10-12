import test from "node:test";
import assert from "node:assert/strict";
import {DAY, metrics, localDay, retainDaily} from "../src/metrics.js";
import {record, DEFAULT_SETTINGS} from "../src/store.js";

test("inclusive inactivity thresholds, pinned exclusion and unknown coverage", () => {
  const now = Date.UTC(2026, 9, 11);
  const tabs = [7 * DAY, 30 * DAY, 7 * DAY - 1, 0].map(age => ({lastAccessedAt: now - age}));
  tabs.push({pinned: true, lastAccessedAt: now - 40 * DAY});
  for (const value of [undefined, null, NaN, Infinity, 0, -1, now + 1]) tabs.push({lastAccessedAt: value});
  assert.deepEqual(metrics(tabs, now), {total: 12, pinned: 1, inactive7Days: 2,
    inactive30Days: 1, unknownInactivity: 7, eligibleUnpinned: 11});
});

test("daily grouping uses local midnight across spring/fall DST, with latest timestamp", () => {
  const previousTZ = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    assert.equal(localDay(Date.parse("2026-03-08T04:59:59Z")), "2026-03-07");
    assert.equal(localDay(Date.parse("2026-03-08T05:00:00Z")), "2026-03-08");
    assert.equal(localDay(Date.parse("2026-11-01T05:30:00Z")), "2026-11-01");
    assert.equal(localDay(Date.parse("2026-11-01T06:30:00Z")), "2026-11-01");
    let state = {settings: DEFAULT_SETTINGS, daily: {}};
    for (const time of ["2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z", "2026-11-01T05:45:00Z"]) {
      state = record(state, [], Date.parse(time), "test");
    }
    assert.equal(Object.keys(state.daily).length, 1);
    assert.equal(state.daily["2026-11-01"].timestamp, Date.parse("2026-11-01T06:30:00Z"));
    assert.equal(state.daily["2026-11-01"].utcOffsetMinutes, -300);
    assert.deepEqual(retainDaily({"2026-03-07": {}, "2026-03-08": {}, "2026-03-09": {}},
      Date.parse("2026-03-09T04:30:00Z"), 2), {"2026-03-08": {}, "2026-03-09": {}});
    // Changing timezone affects new samples, never rewrites existing date keys.
    const before = state.daily["2026-11-01"];
    process.env.TZ = "Pacific/Honolulu";
    state = record(state, [], Date.parse("2026-11-01T07:00:00Z"), "test");
    assert.equal(state.daily["2026-11-01"], before);
    assert.ok(state.daily["2026-10-31"]);
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});
