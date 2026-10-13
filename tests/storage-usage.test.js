import test from "node:test";
import assert from "node:assert/strict";
import {storageUsage, formatBytes} from "../src/storage-usage.js";

test("storage estimates and local logical bytes stay separate; zero usage is a valid reading", async () => {
  const result = await storageUsage({estimate: async () => ({usage: 0, quota: 1024 ** 3})},
    {getBytesInUse: async keys => { assert.equal(keys, null); return 1536; }});
  assert.deepEqual(result, {usage: 0, quota: 1024 ** 3, local: 1536});
  assert.equal(formatBytes(result.usage), "0 B");
  assert.equal(formatBytes(result.quota), "1 GiB");
});

test("unavailable/failed storage APIs do not hide independent valid readings", async () => {
  assert.deepEqual(await storageUsage(undefined, undefined), {usage: null, quota: null, local: null});
  assert.deepEqual(await storageUsage({estimate() { throw new Error("unavailable"); }},
    {getBytesInUse: async () => 12}), {usage: null, quota: null, local: 12});
  assert.deepEqual(await storageUsage({estimate: async () => ({usage: 42, quota: 100})},
    {getBytesInUse: async () => { throw new Error("unavailable"); }}), {usage: 42, quota: 100, local: null});
  assert.deepEqual(await storageUsage({estimate: async () => ({usage: NaN, quota: 100})},
    {getBytesInUse: async () => -1}), {usage: null, quota: 100, local: null});
  for (const value of [null, undefined, NaN, Infinity, -1, "100"]) assert.equal(formatBytes(value), "Unavailable");
});
