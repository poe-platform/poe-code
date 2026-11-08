import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const owned = fileURLToPath(new URL("./", import.meta.url));
const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const revision = "3a1025f53e502c3426ffee34eb8d8037b27c26f8";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const read = name => JSON.parse(fs.readFileSync(join(owned, name), "utf8"));
const git = args => execFileSync("git", args, { cwd: repository, maxBuffer: 16 * 1024 * 1024 });
const attempts = [];
for (const attempt of ["attempt-01", "attempt-02", "attempt-03"]) {
  const manifest = read(`${attempt}/MANIFEST.json`);
  for (const record of manifest.records) {
    const bytes = fs.readFileSync(join(owned, attempt, record.path));
    assert.equal(bytes.length, record.bytes);
    assert.equal(hash(bytes), record.sha256);
  }
  const executions = read(`${attempt}/executions.json.data`);
  const ordinary = executions.filter(execution => !execution.expectedFailure);
  const traces = manifest.records.filter(record => record.path.endsWith(".trace.jsonl.data")).flatMap(record => fs.readFileSync(join(owned, attempt, record.path), "utf8").trim().split("\n").map(line => JSON.parse(line)));
  const roots = traces.filter(record => record.operation === "root");
  for (const record of roots) {
    assert.equal(fs.existsSync(record.root), false);
    assert.ok(traces.find(cleanup => cleanup.operation === "cleanup" && cleanup.root === record.root && cleanup.absent && cleanup.restoredOwnedModes));
  }
  const cleanup = read(`${attempt}/cleanup.json.data`);
  assert.equal(fs.existsSync(cleanup.work), false);
  attempts.push({ attempt, manifestSha256: hash(fs.readFileSync(join(owned, attempt, "MANIFEST.json"))), dataFiles: manifest.records.length,
    tapTests: ordinary.reduce((total, execution) => total + (execution.tap.tests ?? 0), 0),
    tapPassed: ordinary.reduce((total, execution) => total + (execution.tap.pass ?? 0), 0),
    unexpectedFailures: ordinary.filter(execution => execution.status !== 0).map(execution => execution.label),
    nativeRootsRemoved: roots.length,
  });
}
for (const directory of ["failed-attempt-source", "attempt-02-source"]) for (const record of read(`${directory}/MANIFEST.json`).records) {
  const bytes = fs.readFileSync(join(owned, record.path));
  assert.equal(bytes.length, record.bytes);
  assert.equal(hash(bytes), record.sha256);
}
const inventory = read("attempt-03/source-inventory.json.data");
for (const record of inventory.records) assert.equal(hash(fs.readFileSync(join(repository, record.path))), record.sha256, record.path);
const finalIntegrity = read("attempt-03/integrity.json.data");
for (const [file, sha256] of Object.entries(finalIntegrity.reviewSourceHashes)) assert.equal(hash(fs.readFileSync(join(owned, file))), sha256);
const vectors = JSON.parse(git(["show", `${revision}:tests/commands/metadata-stress/permission-profile/author-qualified-v2/vectors.json.data`]));
const traces = label => fs.readFileSync(join(owned, `attempt-03/${label}.trace.jsonl.data`), "utf8").trim().split("\n").map(line => JSON.parse(line));
for (const [label, inputs] of [["qualified-384", vectors.transitions], ["chmod-controls", vectors.controls]]) {
  const trace = traces(label);
  const oracles = trace.filter(record => record.operation === "oracle");
  const modes = trace.filter(record => record.operation === "chmod");
  assert.ok(oracles.length >= inputs.length);
  assert.equal(trace.findIndex(record => record.operation === "chown") < trace.findIndex(record => record.operation === "chmod"), true);
  for (const [index, input] of inputs.entries()) {
    assert.deepEqual(oracles[index].args.slice(5), input.argv);
    assert.equal(oracles[index].args[3], input.umask);
    assert.equal(modes[index].requested, Number.parseInt(input.initial, 8));
    assert.equal(modes[index].measured, modes[index].requested);
    assert.equal(modes[index].gid, 20);
  }
}
const native = read("attempt-03/independent-native-profiles.stdout.log.data");
assert.equal(native.historicalNonmemberCharacterizations, 17);
assert.equal(native.memberTransitions, 4);
assert.equal(native.denialControls, 1);
const transitions = traces("independent-native-profiles").filter(record => record.operation === "chown");
assert.equal(transitions.length, 2);
for (const transition of transitions) assert.deepEqual([transition.beforeGid, transition.gid, transition.afterGid], [0, 20, 20]);
const oldRoot = "tests/commands/metadata-stress/sgid-feasibility/";
const historical = JSON.parse(git(["show", `${revision}:${oldRoot}MANIFEST.json`]));
assert.equal(historical.records.length, 10);
assert.equal(historical.unresolvedOriginalCases, 6);
const oldArchive = historical.records.map(record => {
  const bytes = fs.readFileSync(join(repository, oldRoot, record.destination));
  assert.equal(hash(bytes), record.sha256);
  assert.equal(hash(git(["show", `277a635:${oldRoot}${record.destination}`])), record.sha256);
  return { path: oldRoot + record.destination, sha256: record.sha256, bytes: bytes.length };
});
const normativePath = "tests/commands/core-regression-stress/NORMATIVE_PROFILES.md";
assert.equal(hash(fs.readFileSync(join(repository, normativePath))), "0252eda91265d2074a5983fbbff9a3eff642f06eccde1bc4e9956debd0feb6fb");
const discovered = fs.globSync("**/*.test.ts", { cwd: owned }).sort();
assert.deepEqual(discovered, ["review.test.ts"]);
assert.deepEqual(attempts[0].unexpectedFailures, ["independent-guards"]);
assert.deepEqual(attempts[1].unexpectedFailures, []);
assert.deepEqual(attempts[2].unexpectedFailures, []);
console.log(JSON.stringify({ at: new Date().toISOString(), revision, attempts,
  finalFrozenFilesAuthenticated: inventory.records.length, finalTrackedSourceMatchesFreeze: true,
  exactObservedTransitionVectors: vectors.transitions.length, exactObservedDirectoryControls: vectors.controls.length,
  isolatedHelperMutantsKilled: read("attempt-03/mutations.json.data").filter(record => record.killed).length,
  structuralMutationGuards: read("attempt-03/static-mutations.json.data").count,
  originalRawFilesAuthenticated: read("attempt-03/raw-authentication.json.data").filter(record => record.originalExists && record.originalSha256 === record.sha256).length,
  independentMemberTransitions: native.memberTransitions, independentNonmemberCharacterizations: native.historicalNonmemberCharacterizations,
  independentDenialControls: native.denialControls, actualInheritedToMemberTransitions: transitions,
  oldStrictGap: { cases: 6, records: oldArchive, freshExecutionCount: 0, remainsUnresolved: true },
  discoveredOwnedTests: discovered, fullGateRun: false, linuxRun: false, buildRun: false, dependenciesInstalled: false,
  command: `${process.execPath} ${join(owned, "audit.mjs")}`,
}, null, 2));
