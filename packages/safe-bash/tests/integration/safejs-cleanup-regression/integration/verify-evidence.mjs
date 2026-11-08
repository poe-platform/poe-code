import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const evidence = join(root, "evidence");
const load = filename => JSON.parse(readFileSync(filename, "utf8"));
const sha = filename => createHash("sha256").update(readFileSync(filename)).digest("hex");
const expectedCounts = [[1, 1], [16, 17], [18, 19], [0, 19], [0, 1], [0, 1], [1, 1], [18, 19]];
const attempts = [];
for (let index = 0; index < expectedCounts.length; index += 1) {
  const name = `attempt-${String(index + 1).padStart(2, "0")}`;
  const directory = join(evidence, name);
  const report = load(join(directory, "report.json"));
  assert.equal(report.pin, "f44958bf48778737a58535e2bc9b37c292ac28c4");
  assert.equal(report.privateBefore.head, "bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e");
  assert.equal(report.privateUnchanged, true);
  assert.equal(report.privateEngineUnchanged, true);
  assert.equal(report.publicSourceUnchanged, true);
  assert.equal(report.runtimeFilesUnchanged, true);
  assert.equal(report.toolSourcesUnchanged, true);
  assert.equal(report.archive.entries, 15798);
  assert.equal(report.archive.allBlobIdsVerified, true);
  assert.equal(report.cleanup.removed, true);
  assert.equal(existsSync(report.temporary), false);
  assert.equal(report.cleanup.allChildrenReaped, true);
  assert.deepEqual([report.cases.filter(entry => entry.accepted).length, report.cases.length], expectedCounts[index]);
  for (const [filename, hash] of Object.entries(report.harnessFreeze)) {
    const frozen = index < 2 ? join(evidence, "original-harness", `${filename}.fixture`) : join(directory, "harness", `${filename}.fixture`);
    assert.equal(sha(frozen), hash);
  }
  attempts.push({ name, status: report.status, accepted: expectedCounts[index][0], selected: expectedCounts[index][1], startedAt: report.startedAt, finishedAt: report.finishedAt });
}
const finalDirectory = join(evidence, "attempt-08");
const final = load(join(finalDirectory, "report.json"));
for (const [filename, hash] of Object.entries(final.harnessFreeze)) assert.equal(sha(join(root, filename)), hash);
assert.deepEqual(final.cases.filter(entry => !entry.accepted).map(entry => entry.id), ["literal-grep-caller-sink-error"]);
const details = final.cases.map(entry => load(join(finalDirectory, `${entry.id}.json`)));
for (const detail of details) {
  assert.equal(detail.containment, false);
  assert.equal(detail.atSettlement.cleanupDone, !detail.selected.preabort);
  assert.equal(detail.toolProcessesClosed, true);
  assert.equal(detail.loader.closed, true);
  for (const process of [...detail.toolProcesses, ...detail.loader.toolProcesses]) assert.equal(process.closed, true);
  const settled = detail.events.find(entry => entry.event === "public-exec-settled");
  for (const worker of detail.atSettlement.workers) {
    assert.equal(worker.exited, true);
    assert.equal(worker.terminationSettled, true);
    const order = event => detail.events.find(entry => entry.event === event && entry.id === worker.id).order;
    assert.ok(order("worker-created") < order("worker-exit"));
    assert.ok(order("worker-exit") < order("worker-termination-settled"));
    assert.ok(order("worker-termination-settled") < settled.order);
    assert.ok(detail.events.find(entry => entry.event === "product-cleanup-registered").order < order("worker-created"));
  }
  if (["abort", "overlap"].includes(detail.selected.action) || detail.selected.preabort) assert.equal(detail.error.callerIdentity, true);
  assert.equal(detail.atSettlement.runnerCalls, detail.selected.preabort ? 0 : 1);
  assert.equal(detail.atSettlement.hostCalls, detail.selected.preabort ? 0 : 1);
}
const original = details.find(entry => entry.id === "literal-grep-caller-sink-error");
assert.equal(original.status, "fail");
assert.deepEqual(original.result, { exitCode: 2, stdout: "", stderr: "grep: sink:literal-grep-caller-sink-error\n" });
assert.equal(original.error, null);
let importRecords = 0;
const privateFiles = new Set();
const inventory = load(join(finalDirectory, "runtime-inventory.json"));
for (const filename of readdirSync(finalDirectory).filter(name => name.endsWith(".imports.ndjson"))) {
  for (const line of readFileSync(join(finalDirectory, filename), "utf8").trim().split("\n").filter(Boolean)) {
    const entry = JSON.parse(line);
    if (!entry.loaded) { assert.equal(filename, "public-boundary.imports.ndjson"); continue; }
    assert.equal(entry.sha256, inventory[entry.loaded].sha256);
    if (entry.loaded.startsWith("consumer/packages/safejs/")) privateFiles.add(entry.loaded);
    importRecords += 1;
  }
}
assert.equal(importRecords, final.importsVerified);
console.log(JSON.stringify({ verification: "archival consistency, not an all-green behavioral gate", attempts,
  final: { accepted: 18, selected: 19, originalAssertionStillFailing: original.id, sourceClosureFiles: Object.keys(final.sourceClosure).length,
    privateCopiedFiles: Object.keys(final.engineCopy).length, privateLoadedFiles: privateFiles.size, verifiedImportRecords: importRecords,
    nativeWorkersBeforeSettlement: details.flatMap(entry => entry.workers).length,
    closedToolProcesses: details.flatMap(entry => [...entry.toolProcesses, ...entry.loader.toolProcesses]).length,
    watchdogRescues: 0, allTemporaryTreesRemoved: true }, checkedAt: new Date().toISOString() }, null, 2));
