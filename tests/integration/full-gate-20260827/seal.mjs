import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { hash, repository } from "./inspect.mjs";
import { processes } from "./supervise.mjs";

const scope = "tests/integration/full-gate-20260827", evidence = join(scope, "evidence");
const add = (path, text) => {
  assert.equal(existsSync(path), false, "Never overwrite evidence");
  execFileSync("apply_patch", [], { cwd: repository, input: `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split("\n").map(line => "+" + line).join("\n")}\n*** End Patch\n` });
  assert.equal(readFileSync(path, "utf8"), text);
};
for (const name of ["final-accounting", "12"]) {
  const source = `/tmp/full-gate-prep-selftest-${name}.log`;
  add(join(evidence, "prep", `selftest-${name}.log`), readFileSync(source, "utf8"));
}
const captures = JSON.parse(readFileSync(join(evidence, "capture-manifest.json"), "utf8"));
for (const entry of captures.entries) {
  const stored = readFileSync(entry.archived), bytes = entry.encoding === "base64" ? Buffer.from(stored.toString().trim(), "base64") : stored;
  assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256);
  assert.equal(hash(readFileSync(entry.original)), entry.sha256);
}
const first = JSON.parse(readFileSync(join(evidence, "first/report.json"))), recheck = JSON.parse(readFileSync(join(evidence, "recheck/report.json"))), native = JSON.parse(readFileSync(join(evidence, "native/report.json")));
const phases = [...first.phases, ...recheck.phases, ...native.rows.map(row => row.result)];
const observed = [...new Map(phases.flatMap(phase => phase.observed).map(row => [`${row.pid}:${row.born}`, row])).values()];
const current = processes(), active = observed.filter(known => current.some(row => row.pid === known.pid && row.born === known.born));
assert.deepEqual(active, []);
for (const root of [first.temporary, recheck.root]) assert.equal(existsSync(root), false);
assert.ok(first.temporaryRemoved && recheck.temporaryRemoved && native.temporaryRemoved);
const removed = ["/tmp/full-gate-e36dab2-first", "/tmp/full-gate-e36dab2-recheck", "/tmp/full-gate-e36dab2-native",
  ...["initial", "final", "expanded", "final-accounting", "12"].map(name => `/tmp/full-gate-prep-selftest-${name}.log`)];
for (const path of removed) { assert.equal(existsSync(path), true); rmSync(path, { recursive: true }); assert.equal(existsSync(path), false); }
const result = { sealedAt: new Date().toISOString(), revision: first.revision, originalCapturedFiles: captures.entries.length, allOriginalArchiveHashesVerified: true,
  observedProcessIdentities: observed.length, activeObservedIdentities: active, originalExecutionTreesRemoved: true, removedOwnedCapturePaths: removed,
  sourceAndDependencyChanges: { source: first.sourceChanges, dependencies: first.dependencyChanges }, recheckInputsUnchanged: recheck.inputsUnchanged,
  harnessSha256: Object.fromEntries(readdirSync(scope).filter(name => /\.(mjs|fixture)$/.test(name)).sort().map(name => [name, hash(readFileSync(join(scope, name)))])),
  policy: "Only exact owned capture paths removed after hash verification. No product, original test fixture, private-engine, foreign staging, watcher or unrelated temp path changed. No active recorded child identity found; none signalled." };
add(join(evidence, "cleanup.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ archivedFiles: captures.entries.length, observedIdentities: observed.length, active: active.length, removed: removed.length }, null, 2));
