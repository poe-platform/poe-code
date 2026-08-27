import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { owned, save, sha256 } from "./support.ts";

const read = async name => JSON.parse(await readFile(`${owned}/${name}`, "utf8"));
const start = await read("v2-postfix-start.json");
const records = [];
const dependencies = {};
const pids = new Set();
const collectPids = value => {
  if (!value || typeof value !== "object") return;
  if (Number.isInteger(value.pid) && value.argv && value.cwd) pids.add(value.pid);
  for (const child of Object.values(value)) collectPids(child);
};
const files = ["v2-postfix-original34.json", "v2-postfix-corrected34.json", "v2-postfix-legacy.json", "v2-postfix-author-original.json", "v2-postfix-author-corrected.json", "v2-postfix-author-fixes112.json", "v2-postfix-previous.json", "v2-postfix-types.json"];
for (const file of files) {
  const evidence = await read(file);
  collectPids(evidence);
  for (const record of evidence.records) {
    assert.equal(record.run.timedOut, false); assert.equal(record.run.overflow, false);
    const totals = Object.fromEntries([...record.run.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
    if (evidence.stage !== "types") {
      assert.equal(record.stable, true);
      assert.equal(totals.skipped, 0); assert.equal(totals.cancelled, 0); assert.equal(totals.todo, 0);
    }
    const endInputChanges = [];
    for (const [path, hashes] of Object.entries(record.importedSource)) {
      const current = await readFile(path).then(sha256).catch(() => null);
      if (current !== hashes.after) endInputChanges.push({ path, tested: hashes.after, current });
      if (evidence.stage !== "types") {
        assert.equal(hashes.before, hashes.after); assert.notEqual(hashes.before, null);
        dependencies[path] ??= { current, versions: [] };
        let version = dependencies[path].versions.find(version => version.hash === hashes.after);
        if (!version) { version = { hash: hashes.after, phases: [] }; dependencies[path].versions.push(version); }
        version.phases.push(`${file}: ${record.label}`);
      }
    }
    records.push({ file, label: record.label, stage: evidence.stage, code: record.run.code, totals, beforeHead: record.beforeHead, afterHead: record.afterHead, startingCompilerInputs: Object.keys(record.inputsBefore).length, actualImports: record.imports.length, stable: record.stable, changedRelevant: record.changedRelevant, allSourceChanges: record.allSourceChanges, endInputChanges,
      failedTests: record.run.stdout.split("\n").filter(line => /^not ok \d+ - /u.test(line)) });
  }
}
const legacyEvidence = await read("v2-postfix-legacy.json");
for (const line of legacyEvidence.records[0].run.stdout.split("\n").filter(line => line.startsWith('# {"id":'))) {
  const pid = /"pid":(\d+)/u.exec(line); assert.ok(pid); pids.add(Number(pid[1]));
}
for (const pid of pids) for (const target of [pid, -pid]) {
  let absent = false;
  try { process.kill(target, 0); } catch (error) { assert.equal(error.code, "ESRCH"); absent = true; }
  assert.equal(absent, true, `Owned process/group ${target} remains`);
}
assert.deepEqual((await readdir(owned)).filter(name => /^\.(?:native|verify)-/u.test(name)), []);
for (const [path, hash] of Object.entries(start.frozenFiles)) assert.equal(sha256(await readFile(path)), hash);
for (const [name, hash] of Object.entries(start.oracleHashes)) assert.equal(sha256(await readFile(`${owned}/${name}`)), hash);
assert.equal(sha256(await readFile("src/shell/runtime.ts")), start.runtimeHash);
assert.equal(sha256(await readFile("src/shell/shell.ts")), start.shellHash);
const comparisonFiles = ["v2-postfix-original26-comparison.json", "v2-postfix-corrected26-comparison.json", "v2-postfix-legacy57-comparison.json"];
const comparisons = [];
for (const file of comparisonFiles) {
  const evidence = await read(file);
  comparisons.push({ file, virtualFile: evidence.virtualFile, virtualHash: evidence.virtualHash, nativeFile: evidence.nativeFile, nativeHash: evidence.nativeHash,
    profiles: evidence.comparisons.map(profile => ({ profile: profile.profile, passed: profile.passed, total: profile.total, losses: profile.rows.filter(row => !row.pass).map(({ id, fields }) => ({ id, fields })) })) });
}
const author = await read("v2-postfix-author-fixes112.json");
const authorGroups = { primary: { pass: 0, fail: 0 }, historical: { pass: 0, fail: 0 }, host: { pass: 0, fail: 0 } };
for (const line of author.records[0].run.stdout.split("\n")) {
  const match = /^(ok|not ok) \d+ - (.*)$/u.exec(line);
  if (!match) continue;
  const group = match[2].startsWith("GNU-5.3/") ? "primary" : match[2].startsWith("historical-3.2/") ? "historical" : "host";
  authorGroups[group][match[1] === "ok" ? "pass" : "fail"]++;
}
assert.deepEqual(authorGroups, { primary: { pass: 52, fail: 0 }, historical: { pass: 36, fail: 16 }, host: { pass: 8, fail: 0 } });
const corrected = records.find(record => record.label === "corrected v2 34");
assert.equal(corrected.totals.pass, 34);
assert.equal(records.find(record => record.label === "v2 truthful registry supplemental 1").totals.pass, 1);
const runtimeChangesBetweenPhases = Object.entries(dependencies).filter(([, value]) => value.versions.length > 1);
const runtimeChangesAtEnd = Object.entries(dependencies).filter(([, value]) => value.versions.some(version => version.hash !== value.current));
await save("v2-postfix-summary.json", {
  timestamp: new Date().toISOString(), outcome: "Bounded supported invocation/discovery closure verified; not universal raw parity or clean global typecheck snapshot",
  sourceCommit: start.sourceCommit, runtimeHash: start.runtimeHash, shellHash: start.shellHash,
  startHead: start.head, observedEndHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  records, actualRuntimeDependencies: dependencies, runtimeChangesBetweenPhases, runtimeChangesAtEnd, comparisons, authorGroups,
  preservedOriginalRoleConflicts: ["query-V-verbose", "type-multiple-status"], original34: { pass: 32, total: 34 }, corrected34: { pass: 34, total: 34 }, truthfulRegistry: { pass: 1, total: 1 },
  authorAssertionCorrection: { commit: "29a6122", original: "210/211", corrected: "211/211", proof: "v2-author-assertion-original-proof.json / v2-author-assertion-correction-proof.json / V2_AUTHOR_ASSERTION.md" },
  nativeProvenance: { newWholeNativeCohortsRunThisReplay: 0, legacy57: "Both real profiles captured at d02c3b5; post-ready-legacy-native.json reused unchanged", v2_26: "Both real profiles captured at225f992; v2-native.json reused unchanged", original26: "Original native-preparation.json reused unchanged", focusedNewNativeProbes: 0, existingSelectedRegressionReferences: "61 existing /bin/bash3.2 references (17 descriptor,19 read-options,15 read-fields,10 variable-scope); not new whole-profile captures or pending cohorts", oracleHashes: start.oracleHashes },
  scope: "Legacy72/132, native-role-corrected34 and registry1 close supported invocation semantics and the two routed source findings. Original34 role conflicts, strict file policies, raw path coordinates and historical diagnostic/read-N/POSIX differences remain visible. command-p, aliases/keywords, invalid UTF8 boundaries, limited function display and broader shell features remain limited. No source/dot/eval work performed.",
  compilerQualification: "Global exit0 with a changed imported jq.ts input is NOT a guarded global pass. Build/benchmark results apply to their own stable snapshots; foreign end-tree changes are listed separately. No retry or whole-product claim.",
  cleanup: { pids: [...pids], allRecordedProcessesAndGroupsAbsent: true, temporaryDirectories: [], watchers: [] },
  frozenOriginalAndV2Guards: start.frozenFiles,
  hashes: Object.fromEntries(await Promise.all([...files, ...comparisonFiles].map(async file => [file, sha256(await readFile(`${owned}/${file}`))]))),
});
console.log(JSON.stringify({ cohorts: records.map(({ label, totals, stable, changedRelevant, endInputChanges }) => ({ label, totals, stable, changedRelevant, endInputChanges: endInputChanges.map(row => row.path) })), actualRuntimeDependencies: Object.keys(dependencies).length, runtimeChangesBetweenPhases: runtimeChangesBetweenPhases.map(([path]) => path), runtimeChangesAtEnd: runtimeChangesAtEnd.map(([path]) => path), stoppedGroups: pids.size, authorGroups }, null, 2));
