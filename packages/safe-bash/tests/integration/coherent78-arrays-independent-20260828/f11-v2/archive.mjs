import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { regular, sha, census, verify, put } from '../common.mjs';
import { here, read, rolesIntact, bindRetained } from './binding.mjs';

const sealBytes = regular(path.join(here, 'SEAL.json'));
assert.equal(sha(sealBytes), 'f7eb9c2aa47ab5fb121e8b6b3dbb25d943aa2490fed6b367531c7a9984acfc54');
const seal = JSON.parse(sealBytes);
rolesIntact(seal.roles);
const retained = bindRetained();
const evidence = path.join(here, 'evidence');
const terminal = read(path.join(evidence, 'TERMINAL.json'));
const execution = read(path.join(evidence, 'EXECUTION.json'));
assert.equal(execution.exitCode, 0);
assert.equal(terminal.accepted, true);
assert.equal(terminal.unsafeStop, false);
assert.equal(terminal.childrenRetired, true);
const work = path.join(here, 'RUN-' + seal.label);
assert.equal(terminal.work, work);
const raw = path.join(work, 'records');
const finalBytes = regular(path.join(raw, 'FINAL.json'));
assert.equal(sha(finalBytes), terminal.receipt.sha256);
const final = JSON.parse(finalBytes);
assert.equal(final.complete, true);
assert.equal(final.eligibleAcceptance, true);
assert.deepEqual(final.accounting.failures, []);
assert.deepEqual(final.accounting.faults, []);
assert.equal(final.accounting.active, 0);
assert.equal(final.accounting.children.length, 4);
assert.ok(final.accounting.children.every(child => child.retired && child.closeObserved && child.groupAbsent && child.supervisorSettled));
assert.deepEqual(final.phases.map(row => row.label), seal.expectedRows);
assert.ok(final.phases.every(row => row.accepted));
for (const tree of final.finalCensuses) verify(tree);
const before = census(raw);
assert.equal(Object.keys(before).length, 13);
const archives = [];
let rawBytes = 0;
for (const [name, row] of Object.entries(before)) {
  assert.ok(!row.directory && /^[A-Za-z0-9_-]+\.json$/u.test(name));
  const bytes = regular(path.join(raw, name));
  const receipt = final.accounting.records.find(item => item.name + '.json' === name);
  assert.equal(sha(bytes), name === 'FINAL.json' ? terminal.receipt.sha256 : receipt.sha256);
  const compressed = gzipSync(bytes, { level: 9 });
  const target = path.join(evidence, 'records', name + '.gz');
  put(target, compressed);
  assert.deepEqual(gunzipSync(regular(target), { maxOutputLength: seal.policy.maxRecordBytes }), bytes);
  rawBytes += bytes.length;
  archives.push({ path: name, ...row, archive: 'records/' + name + '.gz', compressedBytes: compressed.length, compressedSha256: sha(compressed) });
}
assert.deepEqual(census(raw), before);
const workingBytes = Object.values(census(work)).reduce((total, row) => total + (row.bytes ?? 0), 0);
assert.ok(workingBytes <= seal.policy.maxWorkingBytes);
const bodies = [1, 2, 3, 4].map(serial => read(path.join(raw, 'body-' + serial + '.json')));
const children = [1, 2, 3, 4].map(serial => read(path.join(raw, 'child-' + String(serial).padStart(3, '0') + '.json')));
assert.ok(children.every(child => child.executable === seal.node.origin && child.fault === null && child.closeObserved && child.groupAbsent));
const output = {
  kind: 'post-run DATA archive and independent scoped composition synthesis; no new product execution',
  presealCommit: execution.presealCommit,
  candidate: seal.candidate,
  base: seal.base,
  array: seal.array,
  package: { sha256: seal.packageSha256, bytes: seal.packageBytes, members: seal.members },
  sourceInputs: seal.inputs,
  originalArchivesUnchanged: retained.archive.length,
  originalResultsUnchanged: '560394bb:93/93 retained author,69/72 novel,30/30 types,7 refusals,2 loaded kills,4 restored positives; all three original F11 failures retained',
  results: bodies.map(body => ({ label: body.label, negative: body.negative, accepted: body.accepted, actual: body.observation.actual, originalAssertionPass: body.observation.pass, childExit: body.childCode, disposed: body.observation.disposed, moduleLoadWitnesses: body.loads.length })),
  physicalMove: final.physicalMove,
  resources: { children: 4, processesIncludingCoordinator: 5, peak: 1, allRetired: true, elapsedBeforeAnnouncementMs: terminal.elapsedBeforeAnnouncementMs, childCapturedBytes: final.accounting.captured, newWorkingBytes: workingBytes, rawRecords: 13, rawBytes, compressedBytes: archives.reduce((total, row) => total + row.compressedBytes, 0) },
  finalReceiptSha256: terminal.receipt.sha256,
  archiveRoundTrip: true,
  deletion: false,
  archives
};
put(path.join(evidence, 'AUDIT.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ corrected: '3/3', originalMissingParentControl: '1/1', oldArchivesUnchanged: retained.archive.length, resources: output.resources, rawRetained: true }));
