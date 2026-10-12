import {readFile, readdir} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import assert from "node:assert/strict";

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
assert.deepEqual(manifest.permissions, ["storage", "sessions", "alarms"]);
assert.equal(manifest.incognito, "not_allowed");
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.background.type, "module");
for (const path of [...manifest.background.scripts, manifest.options_ui.page]) await readFile(path);
for (const directory of ["src", "scripts", "tests"]) {
  for (const file of await readdir(directory, {recursive: true})) {
    if (!file.endsWith(".js")) continue;
    const result = spawnSync(process.execPath, ["--check", `${directory}/${file}`], {stdio: "inherit"});
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
console.log("Manifest privacy assertions, referenced entrypoints, and JavaScript syntax passed.");
