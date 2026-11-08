import assert from "node:assert/strict";
import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { owned, repository, basePath, overlay, freeze, candidate, hash, identity, json, save, inventory, sort } from "./review.mjs";

const read = async path => JSON.parse(await readFile(join(owned, path)));
const pre = await read("PRE.json");
const native = await read("native-table.json");
const controls = JSON.parse(await readFile(join(owned, "controls.stdout.data")));
const nativeParent = await read("native-SETTLED.json");
const controlParent = await read("controls-SETTLED.json");
const table = JSON.parse(await readFile(join(repository, basePath, "fixtures/native-env-cases.json")));
assert.equal(nativeParent.result.status, 0);
assert.equal(controlParent.result.status, 0);
assert.deepEqual(native.summary, { total: 16, matched: 16, mismatched: 0 });
assert.equal(controls.passed, 14);
assert.equal(controls.negativeControls, 11);
assert.equal(native.records.length, table.cases.length);
const classifications = {};
for (const [index, row] of native.records.entries()) {
  const expected = table.cases[index];
  assert.equal(row.id, expected.id);
  assert.equal(row.selected, expected.selected);
  assert.deepEqual(row.expected, expected.expect);
  assert.deepEqual(row.args, [...expected.args, "--", native.fixture.path]);
  assert.equal(row.cwd, join(owned, "native-scratch"));
  const env = { PATH: "/usr/bin:/bin", ...table.sanitizedEnvironment, ...expected.env };
  for (const key of table.removedAmbientKeys) if (!Object.hasOwn(expected.env, key)) delete env[key];
  assert.deepEqual(row.env, env);
  assert(!row.observed.timedOut);
  assert.equal(row.observed.signal, null);
  assert(!row.observed.closure.descendantGroupDetected);
  if (expected.expect.statusClass === "success") {
    assert.equal(row.observed.status, 0);
    assert.equal(row.observed.stdout, `${expected.expect.units}\t${native.fixture.path}\n`);
    assert.equal(row.observed.stderr, "");
    assert.equal(row.classification, "literal-match");
  } else {
    assert.equal(row.observed.status, 1);
    assert.equal(row.observed.stdout, "");
    assert.equal(Buffer.byteLength(row.observed.stderr), 40);
    assert.equal(hash(Buffer.from(row.observed.stderr)), pre.manifest.diagnostic.sha256);
    assert.equal(row.classification, "expected-strict-rejection");
  }
  classifications[row.classification] = (classifications[row.classification] ?? 0) + 1;
}
assert.equal(hash(await readFile(native.fixture.path)), table.fixture.sha256);
assert.equal(native.oracle.sha256, pre.tools.native.sha256);
assert.equal(native.oracle.versionStdout.split("\n")[0], "du (GNU coreutils) 9.7");
assert(native.everyCaseRecordsActualSpawnCwd);
const processes = [];
function absent(target) {
  try { process.kill(target, 0); return false; }
  catch (error) { if (error.code === "ESRCH") return true; throw error; }
}
for (const [phase, pids] of [["native-version-and-rows", native.processClosure.spawnedRootPids], ["native-driver", [nativeParent.result.pid]], ["focused-controls", [controlParent.result.pid]]]) {
  for (const pid of pids) {
    assert(absent(pid) && absent(-pid));
    processes.push({ phase, pid, pgid: pid, rootAndGroupAbsent: true });
  }
}
assert.equal(new Set(processes.map(entry => entry.pid)).size, 19);
for (const parent of [nativeParent, controlParent]) {
  assert(!parent.result.timedOut && !parent.result.termination.termSent && !parent.result.termination.killSent);
  assert(!parent.result.closure.descendantGroupDetected);
}
assert(!native.oracle.versionProcess.termination.termSent && !native.oracle.versionProcess.termination.killSent);
const beforeRemoval = await inventory(join(owned, "runtime"));
assert.deepEqual(beforeRemoval, (await read("RUNTIME-AFTER-PATCH.json")).files);
await save("RUNTIME-POST.json", { files: beforeRemoval, exactInventoryNoAddedEntries: true, originalManifestNotUsedForPatchedBytes: true });
const roots = ["runtime", "native-scratch", "temporary"];
const payloads = [];
for (const root of roots) for (const entry of await inventory(join(owned, root))) {
  assert(!/\.(?:ts|mts)$/u.test(entry.path));
  const path = `${root}/${entry.path}`;
  const bytes = await readFile(join(owned, path));
  payloads.push({ ...identity(path, bytes), base64: bytes.toString("base64") });
}
const archive = gzipSync(Buffer.from(json(payloads)));
const restored = JSON.parse(gunzipSync(archive));
assert.deepEqual(restored, payloads);
for (const { base64, ...entry } of restored) assert.deepEqual(identity(entry.path, Buffer.from(base64, "base64")), entry);
await save("runtime-and-scratch.json.gz.data", archive);
const removed = [];
for (const root of roots) {
  await rm(join(owned, root), { recursive: true });
  await assert.rejects(stat(join(owned, root)), error => error.code === "ENOENT");
  removed.push({ root, actualPostCleanupStat: "ENOENT" });
}
assert(!(await inventory(owned)).some(entry => /\.(?:ts|mts)$/u.test(entry.path)));
await save("QUALIFICATION.json", {
  schema: 1, verdict: "ACCEPTED_NATIVE_ONLY_VERSIONED_QUALIFICATION", overlayCommit: overlay, baseFreeze: freeze, candidateContext: candidate,
  manifestIdentity: pre.manifestIdentity, baseNative: pre.manifest.changedFile.base, patchedNative: pre.manifest.changedFile.overlay, diagnostic: pre.manifest.diagnostic,
  exactlyOneNativeReplay: true, native: native.summary, classifications, focused: { passed: controls.passed, total: controls.total, capturedPositives: controls.positiveRawRows.length, rejectedNegatives: controls.negativeControls },
  allRowInputsEnvironmentOrderStatusAndStdoutIndependentlyChecked: true, nativeOracle: { path: pre.tools.native.path, sha256: pre.tools.native.sha256, version: native.oracle.versionStdout.split("\n")[0] },
  historicalNativeSummaryUnchanged: { total: 16, matched: 13, mismatched: 3 }, historicalSuccessOnlyTailExecuted: false,
  sourcePackageTypeRegressionOrFullCohortsRerun: false, aggregateOldFullGateSuccessClaimed: false, publicDefaultDuClaimed: false,
  modulePurityAcceptance: "previously accepted by root on d53b003b; not rerun or expanded by this native-only qualification",
  scope: native.scope, remainingBlockerForThisNativeQualification: null,
  naturalClosure: { nativeOracleProcesses: 17, nativeDriver: 1, focusedDriver: 1, totalRootsAndGroups: 19, noTimeoutOrForcedTermination: true, processes },
  cleanup: { removed, archive: identity("runtime-and-scratch.json.gz.data", archive), payloadFiles: payloads.length, everyPayloadVerified: true, looseTypeScriptOrAgents: 0 },
  unexecutedThisTurn: ["source cohorts", "pack/install/move", "strict consumer", "scoped 128 regressions", "full recipe", "historical success-only tail"],
  preservedLimits: { O060: "deferred/profile gap/deterministic ordering", v2ToV3Delta: "permanently unproved", originalV9FortyMarkers: "rejected exit 1, never rescored" }
});
process.stdout.write(json({ native: native.summary, classifications, focused: controls.passed, groupsClosed: processes.length, archivedFiles: payloads.length, scratchRemoved: roots.length, sourcePackageOrFullCohortReruns: 0 }));
