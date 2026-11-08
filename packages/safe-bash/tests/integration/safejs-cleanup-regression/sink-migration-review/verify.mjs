import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cases } from "./cases.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const repository = resolve(root, "../../../..");
const load = name => JSON.parse(readFileSync(join(root, name)));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const provenance = load("PROVENANCE.json");
const replays = load("evidence/independent-replays.json");
const historical = load("evidence/attempt-08/report.json");
const revised = load("evidence/revised/report.json");
const original = load("evidence/original/report.json");
const git = (...args) => execFileSync("git", args, { cwd: repository, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, timeout: 15000, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024 });
const owner = "tests/integration/safejs-cleanup-regression/integration";
const oldChild = git("show", `${provenance.original}:${owner}/child.mjs`).toString();
const newChild = git("show", `${provenance.candidate}:${owner}/child.mjs`).toString();
assert.equal(oldChild.replace(provenance.oldAssertion, provenance.newAssertion), newChild);
assert.equal(oldChild.split(provenance.oldAssertion).length, 2);
assert.equal(hash(oldChild), provenance.oldChildSha256);
assert.equal(hash(newChild), provenance.revisedChildSha256);
const changed = git("diff", "--name-only", "--diff-filter=MDRT", provenance.original, provenance.candidate, "--", owner).toString().trim().split("\n");
assert.deepEqual(changed, [`${owner}/child.mjs`]);
for (const [name, entry] of Object.entries(provenance.preservedOriginalTree)) {
  if (name === `${owner}/child.mjs`) continue;
  assert.equal(git("rev-parse", `${provenance.candidate}:${name}`).toString().trim(), entry.oid, name);
}
for (const copy of provenance.copies) {
  const local = readFileSync(join(repository, copy.destination));
  assert.equal(hash(local), copy.sha256, copy.destination);
  assert.deepEqual(local, git("show", `${copy.revision}:${copy.source}`), copy.destination);
}
assert.equal(replays.status, "both-whole-cohorts-captured");
assert.deepEqual(replays.attempts.map(attempt => attempt.profile), ["revised", "original"]);
for (const attempt of replays.attempts) {
  assert.equal(attempt.rescue, false);
  assert.equal(attempt.groupGone, true);
  assert.equal(attempt.waitedForClose, true);
  assert.equal(attempt.parentAlive, true);
  assert.equal(attempt.signal, null);
}
assert.equal(historical.cases.filter(test => test.accepted).length, 18);
assert.equal(historical.cases.length, 19);
const blocked = load("history/sink-migration-v1-report.json");
assert.equal(blocked.status, "infrastructure-failure");
assert.equal(blocked.cases.length, 0);

const cohorts = [];
for (const [profile, report] of [["revised", revised], ["original", original]]) {
  const directory = join(root, "evidence", profile);
  assert.equal(report.pin, provenance.product);
  assert.equal(report.node, "v22.22.2");
  assert.equal(report.status, profile === "revised" ? "pass" : "behavioral-failures");
  assert.equal(report.cases.length, 19);
  assert.equal(report.cases.filter(test => test.accepted).length, profile === "revised" ? 19 : 18);
  assert.deepEqual(report.cases.map(test => test.id), cases.map(test => test.id));
  assert.deepEqual(report.privateBefore, report.privateAfter);
  assert.deepEqual(report.privateBefore.engine, historical.engineCopy);
  assert.deepEqual(report.engineCopy, historical.engineCopy);
  assert.equal(Object.keys(report.engineCopy).length, 264);
  assert.equal(report.privateBefore.head, "bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e");
  assert.equal(report.strictFinalGuards, true);
  assert.equal(report.runtimeFilesUnchanged, true);
  assert.equal(report.toolSourcesUnchanged, true);
  assert.equal(report.cleanup.allChildrenReaped, true);
  assert.equal(report.cleanup.removed, true);
  assert.equal(existsSync(report.temporary), false);
  assert.equal(report.finalizationError, undefined);
  assert.deepEqual(report.sourceClosure, historical.sourceClosure);
  assert.equal(report.archive.sha256, historical.archive.sha256);
  assert.equal(report.package.sha256, historical.package.sha256);
  assert.equal(report.package.zeroRuntimeDependencies, true);
  assert.deepEqual(report.archiveChecks.map(check => check.phase), ["before-build", "after-build", "before-execution", "after-execution"]);
  for (const check of report.archiveChecks) {
    assert.equal(check.tree, "b56256393025d5f0cf0d2b33c05bd5d5f39ac608");
    assert.equal(check.blobsVerified, 15798);
    assert.equal(check.inventorySha256, report.archive.inventorySha256);
    assert.equal(check.emittedDistUnchanged, check.phase !== "before-build");
  }
  for (const name of ["cases.mjs", "guard.mjs", "loader.mjs", "audit.mjs", "run.mjs", "child.mjs"]) {
    const expected = name === "child.mjs" && profile === "revised" ? provenance.revisedChildSha256 : historical.harnessFreeze[name];
    assert.equal(report.harnessFreeze[name], expected);
    assert.equal(hash(readFileSync(join(directory, "harness", name + ".fixture"))), expected);
  }
  const inventory = JSON.parse(readFileSync(join(directory, "runtime-inventory.json")));
  let imports = 0;
  const loadedEngine = new Set();
  for (const name of readdirSync(directory).filter(name => name.endsWith(".imports.ndjson"))) {
    for (const line of readFileSync(join(directory, name), "utf8").split("\n").filter(Boolean)) {
      const entry = JSON.parse(line);
      if (!entry.loaded) { assert.equal(name, "public-boundary.imports.ndjson"); continue; }
      assert.equal(entry.sha256, inventory[entry.loaded]?.sha256, entry.loaded);
      if (entry.loaded.startsWith("consumer/packages/safejs/")) {
        const path = entry.loaded.slice("consumer/packages/safejs/".length);
        assert.equal(entry.sha256, report.engineCopy[path].sha256);
        loadedEngine.add(path);
      }
      imports++;
    }
  }
  assert.equal(imports, report.importsVerified);
  assert.ok(loadedEngine.has("src/run.ts") && loadedEngine.has("src/interp/interpreter.ts"));
  let workers = 0;
  let tools = 0;
  for (const selected of cases) {
    const capture = JSON.parse(readFileSync(join(directory, selected.id + ".json")));
    assert.deepEqual(capture.selected, selected);
    assert.equal(capture.containment, false);
    assert.equal(capture.atSettlement.cleanupDone, !selected.preabort);
    assert.equal(capture.atSettlement.runnerCalls, selected.preabort ? 0 : 1);
    assert.equal(capture.atSettlement.hostCalls, selected.preabort ? 0 : 1);
    assert.equal(capture.status, profile === "original" && selected.id === "literal-grep-caller-sink-error" ? "fail" : "pass");
    const settlement = capture.events.find(event => event.event === "public-exec-settled").order;
    if (!selected.preabort) assert.equal(capture.events.filter(event => event.event === "host-cleanup-done").length, 1);
    for (const worker of capture.atSettlement.workers) {
      assert.equal(worker.exited, true);
      assert.equal(worker.terminationSettled, true);
      const order = name => capture.events.find(event => event.event === name && event.id === worker.id).order;
      assert.ok(capture.events.find(event => event.event === "product-cleanup-registered").order < order("worker-created"));
      assert.ok(order("worker-exit") < order("worker-termination-settled"));
      assert.ok(order("worker-termination-settled") < settlement);
      workers++;
    }
    assert.equal(capture.toolProcessesClosed, true);
    assert.equal(capture.loader.closed, true);
    for (const tool of [...capture.toolProcesses, ...capture.loader.toolProcesses]) {
      assert.equal(tool.closed, true);
      assert.equal(tool.code, 0);
      assert.equal(tool.signal, null);
      tools++;
    }
    assert.ok(!capture.events.some(event => /watchdog|rescue/.test(event.event) && event.event !== "failure-before-rescue"));
  }
  assert.equal(workers, 18);
  assert.equal(tools, 19);
  cohorts.push({ profile, total: 19, passing: report.cases.filter(test => test.accepted).length, nativeWorkersSettledBeforePublicExec: workers, normallyClosedEsbuildServices: tools, importsVerified: imports, actualEngineFiles: loadedEngine.size, privateUnchanged: true, allFourArchivePhases: true, noRescue: true, scratchRemoved: true });
}
assert.deepEqual(revised.sourceClosure, original.sourceClosure);
assert.deepEqual(revised.engineCopy, original.engineCopy);
assert.deepEqual(revised.emittedDist, original.emittedDist);
assert.deepEqual(revised.tooling, original.tooling);
const normalizedSettlement = value => ({ ...value, workers: value.workers.map(({ threadId, ...worker }) => worker) });
for (const selected of cases) {
  const before = load(`evidence/original/${selected.id}.json`);
  const after = load(`evidence/revised/${selected.id}.json`);
  for (const field of ["selected", "publicArgv", "result", "error"]) assert.deepEqual(after[field], before[field], `${selected.id}.${field}`);
  assert.deepEqual(normalizedSettlement(after.atSettlement), normalizedSettlement(before.atSettlement), selected.id);
}
const selectedId = "literal-grep-caller-sink-error";
const previous = load(`history/attempt-08/${selectedId}.json`);
const before = load(`evidence/original/${selectedId}.json`);
const after = load(`evidence/revised/${selectedId}.json`);
for (const field of ["selected", "publicArgv", "result", "error"]) assert.deepEqual(previous[field], before[field], field);
assert.deepEqual(after.result, { exitCode: 2, stdout: "", stderr: "grep: sink:literal-grep-caller-sink-error\n" });
assert.equal(after.error, null);
assert.equal(before.assertion.name, "AssertionError");
assert.equal(before.assertion.message, previous.assertion.message);
assert.equal(after.assertion, undefined);
const seal = { verifiedAt: new Date().toISOString(), reviewer: provenance.reviewer, candidate: provenance.candidate, original: provenance.original, product: provenance.product,
  verdict: "accept-single-fixture-migration-only", changedPreviouslyTrackedIntegrationFiles: changed, otherOriginalFilesUnchanged: provenance.unchangedOtherOriginalFiles,
  cohorts, comparison: { all19InputsArgvResultsErrorsAndNormalizedSettlementEqual: true, originalSinkMatchesImmutableAttempt08: true, result: after.result, error: after.error,
    originalAssertion: before.assertion.message, revisedStatus: after.status, originalStatus: before.status },
  actualSourceHookInjectionNotPrivatePackageImport: true, historicalV1ZeroCaseFailurePreserved: true, noAdditionalCohorts: true };
if (process.argv.includes("--write-seal")) writeFileSync(join(root, "SEAL.json"), JSON.stringify(seal, null, 2) + "\n");
else {
  const { verifiedAt: recordedAt, ...recorded } = load("SEAL.json");
  const { verifiedAt: checkedAt, ...checked } = seal;
  assert.deepEqual(checked, recorded);
  assert.ok(recordedAt && checkedAt);
}
if (existsSync(join(root, "ARTIFACTS.json"))) {
  for (const [name, digest] of Object.entries(load("ARTIFACTS.json").files)) assert.equal(hash(readFileSync(join(root, name))), digest, name);
}
console.log(JSON.stringify(seal, null, 2));
