import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const harness = resolve(directory, "../..");
const repository = resolve(harness, "../../../..");
const owner = "tests/integration/safejs-cleanup-regression/integration";
const baseline = "5009ba8146c73bd5628147707e733384e5cd4aee";
const git = (...args) => execFileSync("git", args, { cwd: repository, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const load = filename => JSON.parse(readFileSync(filename, "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const previousDirectory = join(harness, "evidence/attempt-08");
const currentDirectory = join(harness, "evidence/sink-migration-v2");
const previous = load(join(previousDirectory, "report.json"));
const current = load(join(currentDirectory, "report.json"));
const previousChild = git("show", `${baseline}:${owner}/child.mjs`);
const currentChild = readFileSync(join(harness, "child.mjs"), "utf8");
const oldAssertion = '      assert.equal(caught, true);\n      assert.equal(failure, sinkReason, "Strict caller sink error identity");';
const newAssertion = '      assert.equal(selected.id, "literal-grep-caller-sink-error");\n      assert.equal(caught, false);\n      assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },\n        { exitCode: 2, stdout: "", stderr: "grep: sink:literal-grep-caller-sink-error\\n" });';
assert.equal(previousChild.split(oldAssertion).length, 2);
assert.equal(currentChild, previousChild.replace(oldAssertion, newAssertion));
assert.equal(sha(currentChild), load(join(harness, "migrations/sink-v1/PROVENANCE.json")).candidateChildSha256);
let originalFilesUnchanged = 0;
for (const line of git("ls-tree", "-r", baseline, "--", owner).trim().split("\n")) {
  const [, , kind, oid, filename] = /^(\S+) (\S+) (\S+)\t(.*)$/u.exec(line);
  assert.equal(kind, "blob");
  if (filename === `${owner}/child.mjs`) continue;
  const bytes = readFileSync(join(repository, filename));
  assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), oid, filename);
  originalFilesUnchanged += 1;
}
assert.equal(originalFilesUnchanged, 572);
assert.equal(previous.cases.filter(entry => entry.accepted).length, 18);
assert.equal(current.status, "pass");
assert.equal(current.cases.length, 19);
assert.ok(current.cases.every(entry => entry.accepted && entry.status === 0 && entry.signal === null && !entry.error));
assert.equal(current.pin, previous.pin);
assert.equal(current.archive.sha256, previous.archive.sha256);
assert.equal(current.archive.tree, git("rev-parse", `${current.pin}^{tree}`).trim());
assert.deepEqual(current.sourceClosure, previous.sourceClosure);
assert.deepEqual(current.engineCopy, previous.engineCopy);
assert.deepEqual(current.tooling, previous.tooling);
assert.deepEqual(current.package, previous.package);
assert.deepEqual(current.privateBefore, current.privateAfter);
assert.equal(current.privateBefore.head, "bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e");
assert.equal(current.strictFinalGuards, true);
assert.equal(current.runtimeFilesUnchanged, true);
assert.equal(current.toolSourcesUnchanged, true);
assert.deepEqual(current.boundary, previous.boundary);
assert.deepEqual(current.archiveChecks.map(entry => entry.phase), ["before-build", "after-build", "before-execution", "after-execution"]);
for (const entry of current.archiveChecks) {
  assert.equal(entry.blobsVerified, 15798);
  assert.equal(entry.tree, current.archive.tree);
  assert.equal(entry.inventorySha256, previous.archive.inventorySha256);
  if (entry.phase !== "before-build") assert.equal(entry.emittedDistUnchanged, true);
}
for (const [filename, digest] of Object.entries(current.harnessFreeze)) {
  assert.equal(sha(readFileSync(join(harness, filename))), digest);
  assert.equal(sha(readFileSync(join(currentDirectory, "harness", `${filename}.fixture`))), digest);
  if (filename !== "child.mjs") assert.equal(digest, previous.harnessFreeze[filename]);
}
assert.equal(sha(readFileSync(join(directory, "run.mjs"))), current.migration.versionedRunnerSha256);
assert.equal(sha(readFileSync(join(currentDirectory, "harness/versioned-runner.mjs.fixture"))), current.migration.versionedRunnerSha256);
const section = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)) + end.length);
const previousRunner = readFileSync(join(harness, "run.mjs"), "utf8");
const currentRunner = readFileSync(join(directory, "run.mjs"), "utf8");
for (const [start, end] of [["  const boundary = [", '  ].join("\\n");'], ["function privateState()", "const report ="], ["  for (const entry of cohort) {", "  report.importsVerified = 0;"]]) {
  assert.ok(previousRunner.includes(start) && currentRunner.includes(start));
  assert.equal(section(currentRunner, start, end), section(previousRunner, start, end));
}
const previousCases = load(join(previousDirectory, "freeze.json")).cases;
assert.deepEqual(load(join(currentDirectory, "freeze.json")).cases, previousCases);
let nativeWorkers = 0;
let toolProcesses = 0;
for (const entry of current.cases) {
  const before = load(join(previousDirectory, `${entry.id}.json`));
  const after = load(join(currentDirectory, `${entry.id}.json`));
  assert.deepEqual(after.selected, before.selected);
  assert.equal(after.publicArgv, before.publicArgv);
  assert.deepEqual(after.result, before.result);
  assert.deepEqual(after.error, before.error);
  assert.equal(after.status, "pass");
  if (entry.id !== "literal-grep-caller-sink-error") assert.equal(before.status, "pass");
  else assert.equal(before.status, "fail");
  assert.equal(after.containment, false);
  assert.equal(after.atSettlement.cleanupDone, !after.selected.preabort);
  const settlement = after.events.find(event => event.event === "public-exec-settled").order;
  for (const worker of after.atSettlement.workers) {
    assert.equal(worker.exited, true);
    assert.equal(worker.terminationSettled, true);
    const order = name => after.events.find(event => event.event === name && event.id === worker.id).order;
    assert.ok(after.events.find(event => event.event === "product-cleanup-registered").order < order("worker-created"));
    assert.ok(order("worker-exit") < order("worker-termination-settled"));
    assert.ok(order("worker-termination-settled") < settlement);
    nativeWorkers += 1;
  }
  assert.equal(after.toolProcessesClosed, true);
  assert.equal(after.loader.closed, true);
  for (const process of [...after.toolProcesses, ...after.loader.toolProcesses]) {
    assert.equal(process.closed, true);
    assert.equal(process.code, 0);
    assert.equal(process.signal, null);
    toolProcesses += 1;
  }
  if (["abort", "overlap"].includes(after.selected.action) || after.selected.preabort) assert.equal(after.error.callerIdentity, true);
}
assert.equal(nativeWorkers, 18);
assert.equal(toolProcesses, 19);
const inventory = load(join(currentDirectory, "runtime-inventory.json"));
let imports = 0;
for (const filename of readdirSync(currentDirectory).filter(name => name.endsWith(".imports.ndjson"))) {
  for (const line of readFileSync(join(currentDirectory, filename), "utf8").split("\n").filter(Boolean)) {
    const entry = JSON.parse(line);
    if (entry.loaded) { assert.equal(entry.sha256, inventory[entry.loaded].sha256); imports += 1; }
    else assert.equal(filename, "public-boundary.imports.ndjson");
  }
}
assert.equal(imports, current.importsVerified);
assert.equal(current.cleanup.allChildrenReaped, true);
assert.equal(current.cleanup.removed, true);
assert.equal(existsSync(current.temporary), false);
const blocked = load(join(harness, "evidence/sink-migration-v1/report.json"));
assert.equal(blocked.status, "infrastructure-failure");
assert.equal(blocked.cases.length, 0);
assert.equal(existsSync(blocked.temporary), false);
console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), role: "migration author; independent review pending",
  original: { review: baseline, accepted: 18, total: 19, otherOriginalFilesUnchanged: originalFilesUnchanged },
  candidate: { accepted: 19, total: 19, soleAssertionReplacement: true, allCaseInputsAndObservedResultsEqual: true,
    other18ExpectationsUnchanged: true, sourceClosureFiles: Object.keys(current.sourceClosure).length,
    nativeWorkersSettledBeforePublicExec: nativeWorkers, closedToolProcesses: toolProcesses, importsVerified: imports,
    archivePhases: current.archiveChecks, packageSha256: current.package.sha256, privateBeforeAfterUnchanged: true,
    runtimeAndImportGuardsUnchanged: true, liveTreeNotProductIdentity: true, noRescue: true, temporaryRemoved: true },
  historicalV1BlockerPreserved: true }, null, 2));
