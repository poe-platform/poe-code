import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const own = dirname(fileURLToPath(import.meta.url));
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(own, "manifest.json"), "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const inventory = directory => readdirSync(directory).sort().flatMap(name => {
  const path = join(directory, name);
  if (path === join(own, "manifest.json")) return [];
  const stat = lstatSync(path);
  assert.equal(stat.isSymbolicLink(), false, path);
  return stat.isDirectory() ? [relative(root, path), ...inventory(path)] : [relative(root, path)];
}).sort();
const entries = manifest.roots.flatMap(path => inventory(join(root, path))).sort();
assert.deepEqual(entries, Object.keys(manifest.entries).sort(), "sealed tree entry set, including added files and empty directories");
for (const [path, expected] of Object.entries(manifest.entries)) {
  const full = join(root, path);
  if (expected.kind === "directory") assert.equal(lstatSync(full).isDirectory(), true, path);
  else {
    const bytes = readFileSync(full);
    assert.equal(bytes.length, expected.bytes, path);
    assert.equal(hash(bytes), expected.sha256, path);
  }
}
execFileSync(process.execPath, [join(own, "verify.mjs")], { cwd: root });
const read = path => JSON.parse(readFileSync(join(own, path), "utf8"));
const preparation = read("candidate-run-04/preparation.json"), provenance = read("candidate-run-04/provenance.json");
const source = hash(readFileSync(join(own, "candidate-bre-worker.ts.data")));
assert.equal(source, manifest.candidateSourceSha256);
assert.equal(source, preparation.source); assert.equal(source, provenance.source);
assert.equal(provenance.base, "21220b465537bf45ffcfb36740956a69f43bf75e");
for (const [name, digest] of Object.entries(preparation.driverHashes)) assert.equal(hash(readFileSync(join(own, name))), digest, name);
for (const path of ["tests/commands/expr/repeat-history/invariants.test.ts", "tests/commands/expr/repeat-history/candidate.checks.ts"]) {
  assert.equal(hash(readFileSync(join(root, path))), provenance.testInputs[path], path);
}
const candidate = read("candidate-run-04/observations.json");
const baseline = read("baseline-run-02/observations.json");
assert.equal(candidate.rows.length, 24); assert.equal(baseline.rows.length, 24);
assert.equal(candidate.rows.filter(row => row.cliEqual).length, 19);
assert.equal(baseline.rows.filter(row => row.cliEqual).length, 10);
assert.deepEqual(candidate.rows.filter(row => !row.cliEqual).map(row => row.id), ["aaa", "end-anchor", "literal-suffix", "nested-history", "finite-optional"]);
const original = candidate.rows.filter(row => row.original);
assert.equal(original.length, 8); assert.equal(original.filter(row => row.cliEqual).length, 7);
for (const row of candidate.rows) {
  const prior = baseline.rows.find(previous => previous.id === row.id);
  assert.deepEqual(row.argv, prior.argv); assert.deepEqual(row.expected, prior.expected);
  assert.equal(row.cliEqual, JSON.stringify(row.cli) === JSON.stringify(row.expected));
  if (row.internal.overall) {
    assert.equal(row.internal.overall.start, 0);
    assert.ok(row.internal.overall.end <= Buffer.byteLength(row.argv[1]));
  }
  if (row.internal.capture) {
    assert.ok(row.internal.capture.start >= 0);
    assert.ok(row.internal.capture.end >= row.internal.capture.start);
    assert.ok(row.internal.capture.end <= row.internal.overall.end);
  }
}
for (const id of ["mandatory-no-reference", "alternation-longest"]) {
  const current = candidate.rows.find(row => row.id === id), prior = baseline.rows.find(row => row.id === id);
  assert.deepEqual(current.cli, prior.cli); assert.equal(current.cliEqual, true);
}
for (const [path, count] of [["candidate-run-04/tests.tap", 183], ["baseline-run-02/tests.tap", 149]]) {
  const text = readFileSync(join(own, path), "utf8");
  for (const line of [`# tests ${count}\n`, `# pass ${count}\n`, "# fail 0\n", "# skipped 0\n", "# cancelled 0\n"]) assert.ok(text.includes(line), `${path}: ${line}`);
}
for (const capture of ["baseline-run-01", "baseline-run-02", "candidate-run-01", "candidate-run-02", "candidate-run-03", "candidate-run-04"]) {
  const cleanup = read(`${capture}/cleanup.json`);
  assert.equal(cleanup.removed, true); assert.equal(cleanup.allSynchronousChildrenAwaited, true);
}
console.log(JSON.stringify({ sealed: true, source, tests: { candidate: 183, baseline: 149 }, originalCLI: "7/8; not normative acceptance", selectedCLI: "19/24; five differences retained", livePromotion: false }));
