import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { owned, save, sha256, sourceHashes } from "./support.ts";

const read = async name => JSON.parse(await readFile(`${owned}/${name}`, "utf8"));
const start = await read("post-ready-start.json");
const currentSource = await sourceHashes();
const files = ["post-ready-new.json", "post-ready-legacy.json", "post-ready-author.json", "post-ready-previous-original.json", "post-ready-previous-revised.json", "post-ready-types.json", "post-ready-final-scoped-types.json"];
const phases = [];
const importedDependencies = {};
const pids = new Set();
const collectProcesses = value => {
  if (!value || typeof value !== "object") return;
  if (Number.isInteger(value.pid) && value.argv && value.cwd) pids.add(value.pid);
  for (const child of Object.values(value)) collectProcesses(child);
};
for (const file of files) {
  const evidence = await read(file);
  collectProcesses(evidence);
  for (const record of evidence.records) {
    assert.equal(record.stable, true, `${file}: unstable guard`);
    assert.equal(record.run.timedOut, false); assert.equal(record.run.overflow, false);
    const totals = Object.fromEntries([...record.run.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
    const endInputChanges = [];
    for (const [path, hashes] of Object.entries(record.importedSource)) {
      assert.equal(hashes.before, hashes.after); assert.notEqual(hashes.before, null);
      const current = await readFile(path).then(sha256).catch(() => null);
      if (current !== hashes.after) endInputChanges.push({ path, tested: hashes.after, current });
      if (path.startsWith("src/") && evidence.stage !== "types" && evidence.stage !== "prepare") {
        importedDependencies[path] ??= { versions: [], current };
        let version = importedDependencies[path].versions.find(version => version.hash === hashes.after);
        if (!version) { version = { hash: hashes.after, phases: [] }; importedDependencies[path].versions.push(version); }
        version.phases.push(`${file}: ${record.label}`);
      }
    }
    for (const path of Object.keys(record.executionBefore)) {
      const current = await readFile(path).then(sha256).catch(() => null);
      if (current !== record.executionAfter[path] && !endInputChanges.some(row => row.path === path)) endInputChanges.push({ path, tested: record.executionAfter[path], current });
    }
    phases.push({ file, label: record.label, stage: evidence.stage, beforeHead: record.beforeHead, afterHead: record.afterHead, code: record.run.code, totals, actualImports: record.imports.length, startingListedInputs: Object.keys(record.inputsBefore).length, stableDuringRun: record.stable, sourceChangesDuringRun: record.allSourceChanges, endInputChanges });
  }
}
const originalNative = await read("native-preparation.json");
assert.equal(sha256(await readFile(`${owned}/native-preparation.json`)), sha256(execFileSync("git", ["show", `480be8c:${owned}/native-preparation.json`])));
for (const [path, expected] of Object.entries(start.hashes)) assert.equal(sha256(await readFile(path)), expected);
const legacyNative = await read("post-ready-legacy-native.json");
const precedenceNative = await read("precedence-native.json");
collectProcesses(legacyNative); collectProcesses(precedenceNative);
for (const profile of legacyNative.profiles) {
  assert.equal(profile.rows.length, 57);
  assert.equal(sha256(await readFile(profile.executable)), profile.expectedHash);
  for (const row of profile.rows) { assert.equal(row.result.timedOut, false); assert.equal(row.result.overflow, false); }
}
const legacy = await read("post-ready-legacy-comparison.json");
const fresh = await read("post-ready-new-comparison.json");
for (const profile of legacy.nativeChanges) assert.equal(profile.changed.length, 0);
const legacyRun = await read("post-ready-legacy.json");
for (const line of legacyRun.records[0].run.stdout.split("\n").filter(line => line.startsWith('# {"id":'))) {
  const match = /"pid":(\d+)/u.exec(line); assert.ok(match); pids.add(Number(match[1]));
}
const cleanup = [];
for (const pid of pids) {
  for (const target of [pid, -pid]) {
    let absent = false;
    try { process.kill(target, 0); } catch (error) { if (error.code === "ESRCH") absent = true; else throw error; }
    assert.equal(absent, true, `Tracked process/group ${target} still exists`);
  }
  cleanup.push(pid);
}
assert.deepEqual((await readdir(owned)).filter(name => /^\.(?:native|verify)-/u.test(name)), []);
const oldScopeDiff = execFileSync("git", ["diff", "--name-only", start.head, "--", "tests/shell-stress/invocation-modes", "tests/shell/invocation-modes.test.ts"], { encoding: "utf8" });
assert.equal(oldScopeDiff, "");
const observations = (await read("post-ready-new.json")).records[0].observations;
const failures = fresh.comparisons[0].rows.filter(row => !row.pass).map(row => {
  const actual = JSON.parse(observations.find(observation => observation.id === row.id).child.stdout);
  return { id: row.id, source: actual.source, role: actual.role, args: actual.args, inputHex: actual.inputHex, fields: row.fields, actual: { status: actual.exitCode, stdoutHex: actual.stdoutHex, stderrHex: actual.stderrHex }, native: { status: row.expected.result.code, stdoutHex: row.expected.result.stdoutHex, stderrHex: row.expected.result.stderrHex, cwd: row.expected.result.cwd } };
});
const classifications = {
  "query-V-verbose": "Native command -V absolute path versus virtual relative path: narrow output discrepancy routed to root. Separate registered printf label honestly reflects its implementation, not false availability.",
  "type-multiple-status": "Registered printf command kind differs from native builtin; modern mixed-name status matches. Frozen expectation stays red; do not fabricate builtin availability.",
  "query-empty-and-unsupported-option": "Correct empty/invalid-option statuses and stdout; unsupported-option wording differs from frozen invalid-option diagnostic assertion. Kept red.",
};
await save("post-ready-summary.json", {
  timestamp: new Date().toISOString(), outcome: "RED: 31/34 new holdouts; no complete closure acceptance or source/eval breadth",
  startHead: start.head, endObservedHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  sourceCommits: ["7e69fe19521d806782f135f4d1827052ef6b8976", "6370e717c0f540991fb980a10b36725f301e2f3c", "3aa3a4110c09fbab48d9aa8a8d762f48c8ce56cc", "abdc741c22a3c974f3f3ec00ed8a5caa9f2cf6ac"],
  shellHashes: Object.fromEntries(Object.entries(currentSource).filter(([path]) => path.startsWith("src/shell/"))),
  phases, importedDependencies, endRuntimeDependencyChanges: Object.entries(importedDependencies).filter(([, hashes]) => hashes.versions.some(version => version.hash !== hashes.current)),
  frozenInputs: start.hashes, oldScopesUnchanged: oldScopeDiff === "", newNativeOracleUnchanged: true,
  nativeProfiles: originalNative.profiles.map(({ id, executable, expectedHash }) => ({ id, executable, sha256: expectedHash })),
  comparisons: { legacy57: legacy.comparisons.map(profile => ({ profile: profile.profile, passed: profile.passed, total: profile.total, failures: profile.rows.filter(row => !row.pass).map(({ id, fields }) => ({ id, fields })) })), new26: fresh.comparisons.map(profile => ({ profile: profile.profile, passed: profile.passed, total: profile.total, failures: profile.rows.filter(row => !row.pass).map(({ id, fields }) => ({ id, fields })) })), legacyNativeChanges: legacy.nativeChanges },
  failures, classifications,
  priorTargets: { beforeIndependent: "69/72", nowIndependent: "72/72", closedIndependent: ["sh-posix-special-assignment", "path-command-v", "path-type"], beforeAuthor: "130/132", nowAuthor: "132/132", closedAuthor: ["exact primary 5.3: bash stdin-read-one-byte", "exact primary 5.3: sh stdin-read-one-byte"] },
  precedenceCommit: "da549ff", precedenceProof: "precedence-native.json / precedence-review.json / PRECEDENCE_REVIEW.md",
  cleanup: { checkedProcessAndGroupIds: cleanup, remaining: [], temporaryDirectories: [], watchers: [] },
  regressionNativeReferences: { executable: "/bin/bash", profile: "historical3.2 only", count: 61, descriptor: 17, readOptions: 19, readFields: 15, variableScope: 10, helper: "tests/shell/bash-bugfix-helpers.ts", limit: "Existing synchronous helper has 2-second timeout and 256KiB capture, not per-reference detached group metadata. All test parents completed. Includes existing read delimiter/NUL and cancellation controls, not the paused NUL cohort or known five pending first-read cases." },
  finalTrackedStatus: execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=no"], { encoding: "utf8" }),
  evidenceHashes: Object.fromEntries(await Promise.all([...files, "post-ready-legacy-native.json", "post-ready-new-comparison.json", "post-ready-legacy-comparison.json", "precedence-native.json"].map(async file => [file, sha256(await readFile(`${owned}/${file}`))]))),
});
console.log(JSON.stringify({ phases: phases.map(({ label, code, totals, actualImports, endInputChanges }) => ({ label, code, totals, actualImports, endInputChanges: endInputChanges.map(row => row.path) })), stoppedGroups: cleanup.length, runtimeImportUnion: Object.keys(importedDependencies).length }, null, 2));
