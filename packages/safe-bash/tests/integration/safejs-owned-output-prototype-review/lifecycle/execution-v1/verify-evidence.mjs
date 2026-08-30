import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { git, load, owner, record, repository, sha, verifyOriginal } from "./common.mjs";

assert.equal(process.argv.length, 2, "Read-only evidence verification; no probe execution");
const directory = dirname(fileURLToPath(import.meta.url));
const evidence = join(directory, "evidence/attempt-01");
const report = load(join(evidence, "report.json"));
const cases = load(join(directory, "../CASES.json"));
const original = verifyOriginal();
const freeze = load(join(directory, "RUNNER-FREEZE.json"));
assert.equal(report.runnerCommit, "91464989ff4c563195330cc3a7cacc4500c0bad0");
assert.equal(freeze.priorGuestExecutions, 0);
for (const entry of freeze.files) {
  assert.equal(record(join(directory, entry.path)).sha256, entry.sha256);
  assert.equal(sha(git(repository, "show", `${report.runnerCommit}:${owner}/execution-v1/${entry.path}`)), entry.sha256);
}
assert.deepEqual(load(join(evidence, "private-before.json")), load(join(evidence, "private-after.json")));
assert.deepEqual(load(join(evidence, "shared-before.json")), load(join(evidence, "shared-after.json")));
const immutable = load(join(evidence, "immutable-before.json"));
assert.deepEqual(immutable, load(join(evidence, "immutable-after.json")));
assert.equal(immutable.product.length, 940);
assert.equal(immutable.product.filter(entry => entry.path.startsWith("src/")).length, 213);
assert.equal(immutable.product.filter(entry => entry.path.startsWith("dist/")).length, 708);
assert.equal(immutable.engine.length, 264);
assert.equal(immutable["consumer/node_modules/virtual-bash"].length, 709);
assert.equal(report.privateUnchanged, true);
assert.equal(report.sharedUnchanged, true);
assert.equal(report.guardChecks.length, 22);
assert.ok(report.guardChecks.every(entry => entry.unchanged && entry.newRegularFilesDetected && entry.newSymlinksRefused && !entry.emptyDirectoryAdditionsDetected));
const manifest = new Map(Object.entries(immutable).flatMap(([root, entries]) => entries.map(entry => [`${root}/${entry.path}`, entry.sha256])));
for (const entry of report.imports) assert.equal(entry.sha256, manifest.get(entry.path), entry.path);
assert.equal(report.imports.length, 2240);
assert.equal(report.loadedFiles.length, 224);
assert.equal(report.loadedEngineFiles.length, 63);
assert.equal(report.children.length, 10);
const rows = [];
for (const row of cases.rows) {
  const summary = report.rows.find(entry => entry.id === row.id);
  assert.ok(summary);
  if (summary.classification === "BLOCKED") {
    assert.equal(existsSync(join(evidence, `${row.id}.json`)), false);
    rows.push({ id: row.id, raw: "BLOCKED", executed: false });
    continue;
  }
  const observed = load(join(evidence, `${row.id}.json`));
  const child = report.children.find(entry => entry.id === row.id);
  assert.deepEqual(observed.selected, row);
  assert.equal(observed.classification, summary.classification);
  assert.equal(child.signal, null);
  assert.equal(child.containment, null);
  assert.equal(observed.containment, false);
  assert.equal(observed.disposeSettled, true);
  assert.equal(observed.disposed, true);
  assert.deepEqual(observed.guard, { failures: [], activeTimers: 0, workersCreated: 0, subprocessesCreated: 0, socketsCreated: 0 });
  assert.deepEqual(observed.unhandled, []);
  assert.equal(observed.atSettlement.cleanupDone, true);
  assert.equal(observed.atSettlement.releases, 1);
  assert.equal(observed.atSettlement.bridgePending, 0);
  if (observed.engineRuns) {
    assert.deepEqual(observed.literalInvoke, { name: "safejs", args: ["-e", readFileSync(join(directory, "..", row.guest), "utf8"), "--", ...row.guestArgs] });
    assert.equal(observed.budgetOptions.maxSteps, row.maxSteps ?? cases.defaultSafeJsLimits.maxSteps);
    assert.deepEqual(observed.events.find(entry => entry.event === "engine-enter").modules, row.route === "shell-module" ? ["fs", "stdio", "command", "shell"] : ["fs", "stdio", "command"]);
  }
  if (summary.classification === "PASS") {
    assert.ok(observed.assertions.every(entry => entry.pass));
    assert.equal(child.code, 0);
  } else assert.equal(child.code, 1);
  rows.push({ id: row.id, raw: summary.classification, executed: observed.engineRuns === 1, failedAssertions: observed.assertions.filter(entry => !entry.pass).map(entry => entry.name) });
}
const failed = load(join(evidence, "L05-execution-error.json"));
assert.equal(failed.classification, "FAIL");
assert.equal(failed.atSettlement.cleanupIdentity, true);
assert.equal(failed.atSettlement.executionIdentity, false);
assert.equal(failed.events.find(entry => entry.event === "safejs-invoke-settled").status, 1);
assert.equal(failed.publicOutcome.error.message, "cleanup:L05-execution-error");
assert.equal(failed.events.filter(entry => entry.event === "public-diagnostic-rejected").length, 3);
const invalid = load(join(evidence, "L06-curl-open.json"));
assert.equal(invalid.classification, "INVALID_FIXTURE");
assert.equal(invalid.engineRuns, 0);
assert.equal(invalid.publicOutcome.result.stderr, "shell: line 1: Invalid network limit: maxRedirects\n");
assert.equal(invalid.atSettlement.authorizeCalls, 0);
assert.equal(invalid.atSettlement.transportCleanupRegistered, false);
assert.equal(cases.curlInputs.limits.maxRedirects, 0);
assert.equal(cases.curlInputs.limits.maxRetries, 0);
assert.equal(report.rows.find(entry => entry.id === "L06-curl-consumer-closed").classification, "BLOCKED");
assert.equal(report.status, "BOUNDED_NONPASS");
assert.equal(report.cleanup.knownCaseChildrenClosed, true);
assert.equal(report.cleanup.removed, true);
assert.equal(existsSync(report.temporary), false);
console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), status: "EVIDENCE_CONSISTENT_BOUNDED_NONPASS", runtimeAcceptance: false,
  original, runnerCommit: report.runnerCommit, rawCounts: report.counts, rows,
  qualification: { passingRows: 8, failedAssertionPreserved: true, unprovedSelectedExecutionTarget: "L05-execution-error", invalidConfiguration: "L06-curl-open", blockedPositiveDependency: "L06-curl-consumer-closed", newPrototypeBugEstablished: false },
  sourceGuards: { product: 940, source: 213, compiled: 708, engine: 264, package: 709, checks: 22, importRecords: 2240, uniqueLoaded: 224, engineLoaded: 63, newRegularEntriesChecked: true, emptyDirectoryAdditionsChecked: false },
  privateBeforeAfterUnchanged: true, sharedBeforeAfterUnchanged: true, knownChildrenNaturallyClosed: 10, containment: false, temporaryRemoved: true,
  caveat: "Offline evidence consistency only; no changed assertion, rerun, independent acceptance or promotion",
}, null, 2));
