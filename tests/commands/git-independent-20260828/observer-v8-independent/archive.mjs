import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { regular, put, sha, census, verify } from './common.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../../..');
const read = filename => JSON.parse(regular(filename));
const sealBytes = regular(path.join(here, 'SEAL.json')); assert.equal(sha(sealBytes), '0a7adae6a9fb3c8f63b6ad97313584e798bf9ef105febc1b5674f8e773fdd391');
const seal = JSON.parse(sealBytes), evidence = path.join(here, 'evidence');
for (const role of seal.roles) { const filename = path.join(repo, role.path); assert.equal(sha(regular(filename)), role.sha256); assert.equal(fs.lstatSync(filename).mode & 0o777, role.mode); }
for (const tree of seal.protectedTrees) verify(tree);
assert.equal(sha(regular(seal.node.path)), seal.node.sha256);
const terminal = read(path.join(evidence, 'TERMINAL.json')), execution = read(path.join(evidence, 'EXECUTION.json'));
assert.equal(execution.exitCode, 0); assert.equal(terminal.accepted, true); assert.equal(terminal.unsafeStop, false); assert.equal(terminal.childrenRetired, true);
const work = path.join(here, 'RUN-' + seal.label), records = path.join(work, 'records'); assert.equal(terminal.work, work);
const finalBytes = regular(path.join(records, 'FINAL.json')); assert.equal(sha(finalBytes), terminal.receipt.sha256);
const final = JSON.parse(finalBytes); assert.equal(final.complete, true); assert.equal(final.eligibleAcceptance, true); assert.deepEqual(final.accounting.failures, []); assert.deepEqual(final.accounting.faults, []); assert.equal(final.accounting.active, 0); assert.equal(final.accounting.children.length, 2); assert.ok(final.accounting.children.every(row => row.retired && row.groupAbsent && row.closeObserved && row.supervisorSettled));
for (const tree of final.finalCensuses) verify(tree);
const original = read(path.join(records, 'observations-1.json')), independent = read(path.join(records, 'observations-2.json'));
assert.equal(original.cases.length, 19); assert.equal(independent.cases.length, 5); assert.ok([...original.cases, ...independent.cases].every(row => row.passed));
const before = census(records), index = [];
assert.equal(Object.keys(before).length, 6);
for (const [name, row] of Object.entries(before)) {
  assert.ok(!row.directory && /^[A-Za-z0-9_-]+\.json$/u.test(name)); const bytes = regular(path.join(records, name));
  const receipt = final.accounting.records.find(value => value.name + '.json' === name);
  assert.equal(sha(bytes), name === 'FINAL.json' ? terminal.receipt.sha256 : receipt.sha256);
  const target = path.join(evidence, 'records', name); put(target, bytes); assert.deepEqual(regular(target), bytes);
  index.push({ path: name, ...row, archive: 'records/' + name, encoding: 'byte-identical uncompressed JSON; no zlib archive operation' });
}
assert.deepEqual(census(records), before);
const real = original.cases.filter(row => row.role === 'real');
assert.equal(real.length, 6); assert.ok(real.every(row => row.ownedCleanup.actualClosed && row.ownedCleanup.actualDestroyed && row.ownedCleanup.closeDelivered && row.ownedCleanup.settled && row.ownedCleanup.ownedOperationPending === 0 && row.hooks.destroyRestored && row.hooks.callbacksRestored));
const result = { kind: 'independent observer qualification; candidate adapter NOT admitted', presealCommit: execution.presealCommit, sealSha256: sha(sealBytes), observer: seal.bindings.find(row => row.path.endsWith('/observer.mjs')), retirement: seal.bindings.find(row => row.path.endsWith('/retirement.mjs')), original: { assertions: 19, real: 6, synthetic: 11, data: 2, S07subcases: original.cases.find(row => row.id === 'S07').subcases }, independent: independent.cases.map(row => ({ id: row.id, passed: row.passed, detail: row.detail, syntheticResources: row.syntheticResources })), R05: real.find(row => row.id === 'R05'), rawCallbackPendingDiagnostics: real.filter(row => row.ownedCleanup.writePending).map(row => ({ id: row.id, pending: row.ownedCleanup.writePending })), resources: { children: 2, peakIncludingCoordinator: 2, allRetired: true, elapsedBeforeAnnouncementMs: terminal.elapsedBeforeAnnouncementMs, captureBytes: final.accounting.captured, rawBytes: index.reduce((total, row) => total + row.bytes, 0), newWorkBytes: Object.values(census(work)).reduce((total, row) => total + (row.bytes ?? 0), 0), actualInflateObjectsInQualifier: 6, independentActualInflateObjects: 0, nativeAllocationCountClaim: false }, protectedOldTrees: seal.protectedTrees.map(tree => ({ root: tree.root, entries: Object.keys(tree.entries).length, unchanged: true })), finalReceiptSha256: terminal.receipt.sha256, archives: index, rawRetained: true, deletion: false, candidateExecutions: 0, continuationExecutableSeal: null };
assert.ok(result.resources.newWorkBytes < seal.policy.maxWorkingBytes);
put(path.join(evidence, 'AUDIT.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ original: '19/19 assertions', independent: '5/5 synthetic assertions', resources: result.resources, preserved: result.protectedOldTrees, candidateExecutions: 0, continuationReady: false }));
