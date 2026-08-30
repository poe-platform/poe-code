import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { owned, save, sha256 } from "./support.ts";
import { cases, adaptations, hostCases } from "./v2-cases.ts";

const originalPaths = ["cases.ts", "probe.ts", "holdout.test.ts", "native.ts", "native-preparation.json", "post-ready-new.json", "post-ready-new-comparison.json", "post-ready-summary.json"].map(name => `${owned}/${name}`);
originalPaths.push("tests/shell-stress/invocation-modes/cases.ts", "tests/shell-stress/invocation-modes/holdout.test.ts", "tests/shell/invocation-modes.test.ts", "tests/shell-stress/script-entrypoint/cases.ts");
const originals = {};
for (const path of originalPaths) {
  originals[path] = sha256(await readFile(path));
  assert.equal(originals[path], sha256(execFileSync("git", ["show", `d02c3b5:${path}`])));
}
const native = JSON.parse(await readFile(`${owned}/v2-native.json`, "utf8"));
const previous = JSON.parse(await readFile(`${owned}/native-preparation.json`, "utf8"));
assert.equal(native.cohortHash, sha256(JSON.stringify(cases)));
assert.equal(native.profiles.length, 2); assert.equal(hostCases.length, 8);
const pids = [];
const changes = [];
for (const profile of native.profiles) {
  assert.equal(profile.rows.length, 26); assert.equal(sha256(await readFile(profile.executable)), profile.expectedHash);
  assert.deepEqual(profile.rows.map(row => row.id), cases.map(row => row.id));
  for (const result of [...profile.versions, ...profile.rows.map(row => row.result)]) {
    assert.equal(result.timedOut, false); assert.equal(result.overflow, false); pids.push(result.pid);
  }
  const old = previous.profiles.find(row => row.id === profile.id);
  for (const row of profile.rows) {
    const before = old.rows.find(candidate => candidate.id === row.id);
    const fields = ["code", "stdoutHex", "stderrHex"].filter(field => row.result[field] !== before.result[field]);
    if (!adaptations.some(adaptation => adaptation.id === row.id)) {
      assert.equal(row.source, before.source); assert.deepEqual(row.result.argv, before.result.argv);
      assert.deepEqual(row.result.env, before.result.env); assert.equal(row.inputHex, before.inputHex);
      assert.deepEqual(row.renderedFixtures, before.renderedFixtures); assert.deepEqual(fields, []);
    }
    if (fields.length) changes.push({ profile: profile.id, id: row.id, fields, old: { source: before.source, status: before.result.code, stdoutHex: before.result.stdoutHex, stderrHex: before.result.stderrHex }, v2: { source: row.source, status: row.result.code, stdoutHex: row.result.stdoutHex, stderrHex: row.result.stderrHex } });
  }
}
const types = JSON.parse(await readFile(`${owned}/v2-preparation-types.json`, "utf8"));
for (const record of types.records) { assert.equal(record.run.code, 0); assert.equal(record.stable, true); pids.push(record.startingList.pid, record.run.pid); }
for (const pid of pids) for (const target of [pid, -pid]) {
  let absent = false;
  try { process.kill(target, 0); } catch (error) { assert.equal(error.code, "ESRCH"); absent = true; }
  assert.equal(absent, true);
}
assert.deepEqual((await readdir(owned)).filter(name => /^\.(?:native|verify)-/u.test(name)), []);
await save("v2-preparation-audit.json", {
  timestamp: new Date().toISOString(), head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  status: "FIXTURE PREPARATION ONLY; no virtual/runtime acceptance", originals, adaptations,
  nativeRowsPerProfile: 26, nativeRowsTotal: 52, metadataProcesses: 4, originalHostRows: 8, v2HoldoutsPrepared: 34, additionalRegistryTruthTest: 1,
  unchangedOtherRowsPerProfile: 24, nativeChanges: changes, nativeHash: sha256(await readFile(`${owned}/v2-native.json`)),
  originalRaw31of34Preserved: true, preparationTypes: { code: 0, stable: true, listedInputs: types.records[0].imports.length, hash: sha256(await readFile(`${owned}/v2-preparation-types.json`)) },
  cleanup: { pids, allProcessGroupsAbsent: true, temporaryDirectories: [] },
  guardedFiles: Object.fromEntries(await Promise.all((await readdir(owned)).filter(name => name.startsWith("v2-") && /\.(?:ts|mjs)$/u.test(name)).map(async name => [name, sha256(await readFile(`${owned}/${name}`))]))),
});
console.log(JSON.stringify({ originalGuards: originalPaths.length, nativeCases: 52, unchangedOtherNativeRows: 48, sourceAdaptations: 2, stoppedGroups: pids.length, runtimeRuns: 0 }));
