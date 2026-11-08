import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { git, load, record, repository, sha } from "./common.mjs";
import { verifyProfile } from "./profile.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const lifecycle = dirname(directory);
const evidence = join(directory, "evidence/attempt-01");
const report = load(join(evidence, "report.json"));
const freeze = load(join(directory, "RUNNER-FREEZE.json"));
const cases = load(join(directory, "CASES.json"));
const revision = load(join(directory, "REVISION.json"));
const freezeCommit = "3f6db4dd29950d92410a4d4f9871ba18a5b56e89";
const profile = verifyProfile();
assert.deepEqual(profile, load(join(directory, "PROFILE-PROOF.json")));
assert.equal(report.runnerCommit, freezeCommit);
assert.equal(report.runnerAfterCommit, freezeCommit);
for (const entry of [...freeze.files, { path: "RUNNER-FREEZE.json", sha256: record(join(directory, "RUNNER-FREEZE.json")).sha256 }]) {
  const path = `tests/integration/safejs-owned-output-prototype-review/lifecycle/execution-v2/${entry.path}`;
  assert.equal(record(join(directory, entry.path)).sha256, entry.sha256);
  assert.equal(sha(git(repository, "show", `${freezeCommit}:${path}`)), entry.sha256);
}
assert.equal(report.status, "PASS");
assert.deepEqual(report.counts, { total: 11, logicalWorkflows: 6, executed: 11, valid: 11, pass: 11, failed: 0, invalid: 0, unproved: 0, blocked: 0 });
assert.deepEqual(load(join(evidence, "private-before.json")), load(join(evidence, "private-after.json")));
assert.deepEqual(load(join(evidence, "private-before.json")), load(join(lifecycle, "execution-v1/evidence/attempt-01/private-after.json")));
const privateState = load(join(evidence, "private-after.json"));
assert.equal(privateState.head, "bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e");
assert.equal(privateState.engine.length, 264);
assert.equal(Object.keys(privateState.metadata).length, 6);
assert.equal(report.privateUnchanged, true);
assert.deepEqual(load(join(evidence, "shared-before.json")), load(join(evidence, "shared-after.json")));
assert.equal(report.sharedUnchanged, true);
const immutable = load(join(evidence, "immutable-before.json"));
assert.deepEqual(immutable, load(join(evidence, "immutable-after.json")));
assert.equal(immutable.product.length, 940);
assert.equal(immutable.engine.length, 264);
assert.equal(immutable["consumer/node_modules/virtual-bash"].length, 709);
const source = immutable.product.filter(entry => entry.path.startsWith("src/")).map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
const compiled = immutable.product.filter(entry => entry.path.startsWith("dist/")).map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
assert.equal(source.length, 213); assert.equal(compiled.length, 708);
assert.equal(sha(JSON.stringify(source)), "6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea");
assert.equal(sha(JSON.stringify(compiled)), "2578b6ea39cfdeb5b942b9aff20ec9bfff1fcf907cd2af751d8e73f5c24e632f");
const files = new Map(Object.entries(immutable).flatMap(([prefix, entries]) => entries.map(entry => [`${prefix}/${entry.path}`, entry.sha256])));
const importRecords = [];
const kinds = {};
for (const filename of readdirSync(evidence).filter(name => name.endsWith(".imports.ndjson"))) {
  for (const line of readFileSync(join(evidence, filename), "utf8").trim().split("\n").filter(Boolean)) {
    const entry = JSON.parse(line);
    assert.equal(files.get(entry.path), entry.sha256, entry.path);
    assert.equal(entry.pid, report.children.find(child => filename === `${child.id}.imports.ndjson`).pid);
    importRecords.push({ report: filename, ...entry });
    kinds[entry.kind] = (kinds[entry.kind] ?? 0) + 1;
  }
}
assert.deepEqual(importRecords, report.imports);
assert.equal(report.guardChecks.length, 24);
assert.ok(report.guardChecks.every(entry => entry.unchanged && entry.newRegularFilesDetected && entry.newSymlinksRefused && entry.emptyDirectoryAdditionsDetected === false));
assert.equal(report.children.length, 11);
const rows = [];
for (const row of cases.rows) {
  const child = report.children.find(entry => entry.id === row.id);
  const detail = load(join(evidence, `${row.id}.json`));
  assert.equal(child.code, 0); assert.equal(child.signal, null); assert.equal(child.containment, null);
  assert.ok(child.closed && Date.parse(child.started) >= Date.parse(freeze.frozenAt));
  assert.equal(detail.classification, "PASS"); assert.equal(detail.engineRuns, 1);
  assert.deepEqual(detail.selected, row);
  assert.equal(detail.variantId, revision.variants[row.id]?.variantId ?? row.id);
  assert.equal(detail.publicSource, revision.variants[row.id]?.publicSource ?? cases.commonInputs.publicShellCommand);
  assert.equal(detail.publicSourceHex, Buffer.from(detail.publicSource).toString("hex"));
  assert.deepEqual(detail.literalInvoke, { name: "safejs", args: ["-e", readFileSync(join(lifecycle, row.guest), "utf8"), "--", ...row.guestArgs] });
  assert.equal(detail.budgetOptions.maxSteps, row.maxSteps ?? cases.defaultSafeJsLimits.maxSteps);
  assert.ok(detail.assertions.length > 0 && detail.assertions.every(entry => entry.pass));
  assert.equal(detail.atSettlement.cleanupDone, true); assert.equal(detail.atSettlement.releases, 1);
  assert.equal(detail.atSettlement.bridgePending, 0); assert.equal(detail.disposeSettled, true);
  assert.ok(detail.disposed || detail.expectedDisposeCleanupObserved);
  assert.deepEqual(detail.guard, { failures: [], activeTimers: 0, workersCreated: 0, subprocessesCreated: 0, socketsCreated: 0 });
  assert.deepEqual(detail.unhandled, []);
  if (!revision.variants[row.id]) {
    const original = load(join(lifecycle, "execution-v1/evidence/attempt-01", `${row.id}.json`));
    for (const field of ["kind", "result", "stdoutHex", "stderrHex"]) assert.deepEqual(detail.publicOutcome[field], original.publicOutcome[field], `${row.id}:${field}`);
  }
  rows.push({ id: row.id, variantId: detail.variantId, classification: detail.classification, pid: child.pid, assertions: detail.assertions.length });
}
const selected = load(join(evidence, "L05-execution-error.json"));
assert.deepEqual(selected.selector, { calls: 1, throws: 1, publicResultAbsent: true, publicExecutionIdentity: true, callerAborted: false });
assert.equal(selected.publicOutcome.kind, "rejection");
assert.equal(Object.hasOwn(selected.publicOutcome, "result"), false);
assert.equal(selected.publicOutcome.stdoutHex, "61646d69747465640a");
assert.equal(selected.publicOutcome.stderrHex, "");
assert.deepEqual(selected.events.filter(entry => entry.event === "public-diagnostic-rejected").map(entry => Buffer.from(entry.attemptedHex, "hex").toString()), revision.variants[selected.id].expectedDiagnosticAttempts);
for (const id of ["L06-curl-open", "L06-curl-consumer-closed"]) {
  const detail = load(join(evidence, `${id}.json`));
  assert.deepEqual(detail.network.authorizationJournal, [{ call: 1, url: cases.curlInputs.authorizedUrl, method: "PUT", attempt: 0, hasRedirectFrom: false, signalAborted: false, allowed: true }]);
  assert.deepEqual(detail.network.transportJournal, [{ call: 1, url: cases.curlInputs.authorizedUrl, method: "PUT", signalAborted: false, allowed: true }]);
  assert.equal(detail.network.transportCleanupCalls, 1); assert.equal(detail.network.responseDisposeCalls, 1);
  for (const [path, bytes] of Object.entries(cases.curlInputs.requiredFiles)) assert.equal(detail.files[path].hex, Buffer.from(bytes).toString("hex"));
}
assert.ok(Date.parse(report.children.find(entry => entry.id === "L06-curl-open").closed) < Date.parse(report.children.find(entry => entry.id === "L06-curl-consumer-closed").started));
assert.equal(report.cleanup.knownCaseChildrenClosed, true); assert.equal(report.cleanup.removed, true);
assert.equal(existsSync(report.cleanup.temporary), false);
const publicBefore = new Map(report.publicBefore.source.map(entry => [entry.path, entry]));
const publicAfter = new Map(report.publicAfter.source.map(entry => [entry.path, entry]));
const foreignLiveChanges = [...new Set([...publicBefore.keys(), ...publicAfter.keys()])].filter(path => JSON.stringify(publicBefore.get(path)) !== JSON.stringify(publicAfter.get(path)))
  .map(path => ({ path: `src/${path}`, before: publicBefore.get(path), after: publicAfter.get(path) }));
console.log(JSON.stringify({ status: "AUTHOR_V2_EVIDENCE_CONSISTENT", verifiedAt: new Date().toISOString(), freezeCommit,
  noPromotion: true, independentAcceptance: false, newRuntimeExecutions: 0, counts: report.counts, rows,
  original74Unchanged: true, proposal5Unchanged: true, runnerFreezeUnchanged: true, originalRawCountsUnchanged: revision.originalRawCounts,
  sourceFiles: source.length, productFiles: 940, compiledFiles: compiled.length, packageFiles: 709,
  importRecords: importRecords.length, importKinds: kinds, uniqueLoggedFiles: new Set(importRecords.map(entry => entry.path)).size,
  engineUniqueLoggedFiles: report.loadedEngineFiles.length, regularCopyChecks: report.guardChecks.length,
  privateBeforeAfterUnchanged: true, sharedBeforeAfterUnchanged: true, childrenNaturallyClosed: report.children.length,
  remainingTrackedTimers: 0, containment: false, temporaryRemoved: true, foreignLiveChanges,
  caveat: "Read-only consistency of frozen author assertions and captured reference-identity booleans, not a new runtime run, independent replay, current live product gate, zero-host-cap support or universal parity."
}, null, 2));
