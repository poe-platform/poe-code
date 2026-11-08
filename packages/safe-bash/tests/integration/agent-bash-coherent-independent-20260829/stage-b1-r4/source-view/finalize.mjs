import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root = '/Users/kjopek/Workspace/safe-bash';
const scope = import.meta.dirname;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function admit(filename, expected, ceiling = 262144) {
  const stat = fs.lstatSync(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.ok(stat.size <= ceiling);
  if (expected) assert.equal(stat.size, expected.bytes);
  const bytes = fs.readFileSync(filename); assert.equal(bytes.length, stat.size);
  if (expected) assert.equal(hash(bytes), expected.sha256);
  return bytes;
}
const seal = JSON.parse(admit(path.join(scope, 'PRESEAL.json'), { bytes: 20804, sha256: 'a7c5e284c4dedbb1726e2231a5e67b44ef960f55203706c73b79ce2e63fa8b70' }));
const publication = JSON.parse(admit(path.join(scope, 'PUBLICATION-BINDING.json'), { bytes: 3872, sha256: '8cc5f053a7331bd7c31d73064269d2034485a0aa78b4a8c96128af2e3b0559ea' }));
const controls = JSON.parse(admit(path.join(scope, 'CONTROL-PRESEAL.json'), { bytes: 2602, sha256: '460c90fa20414c2f12e837194cd19ca04d01e895efc9daef82fc0ae728d37ec5' }));
const postguards = [];
for (const entry of seal.files.filter(entry => entry.path.includes('/stage-b1-r4/') || entry.path.endsWith('/stage-b1-r3/layout.mjs'))) {
  admit(path.join(root, entry.path), entry); postguards.push(entry);
}
for (const entry of controls.files) admit(path.join(scope, entry.path), entry);
const resultBytes = admit(path.join(scope, 'CONTROL-RESULT.json'));
const resultReceipt = { bytes: resultBytes.length, sha256: hash(resultBytes) };
fs.writeFileSync(path.join(scope, 'CONTROL-RESULT-RECEIPT.json'), JSON.stringify(resultReceipt, null, 2) + '\n', { flag: 'wx' });
const result = JSON.parse(resultBytes); assert.equal(result.rows.length, 8); assert.ok(result.rows.every(row => row.status === 'PASS'));
const captures = [];
for (const stem of ['inspect', 'publication-inspection', 'prepare', 'materialize', 'source-commit', 'seal', 'preseal-commit', 'controls', 'final']) {
  for (const suffix of ['stdout', 'stderr']) {
    const filename = `/private/tmp/coherent-b1-r4-${stem}.${suffix}`;
    if (!fs.existsSync(filename)) continue;
    const body = admit(filename, undefined, 4194304); captures.push({ path: filename, bytes: body.length, sha256: hash(body), live: stem === 'final' });
  }
}
const inventory = [];
for (const name of fs.readdirSync(scope)) {
  const filename = path.join(scope, name); const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink()); const body = admit(filename, undefined, 1048576);
  inventory.push({ path: name, bytes: body.length, sha256: hash(body) });
}
const capturedBytes = captures.reduce((total, entry) => total + entry.bytes, 0);
const ownedBytes = inventory.reduce((total, entry) => total + entry.bytes, 0);
assert.ok(capturedBytes + 1048576 < 50331648); assert.ok(ownedBytes + capturedBytes + 4194304 < 201326592);
const receipt = {
  schema: 'B1-r4-review-handoff-v1', utc: new Date().toISOString(), pid: process.pid,
  sourceCommit: '14be114b99bd4df2e275ee5d1f59db45bb2085d9', presealCommit: '78ea583944726028dad30e5d0146b614772cfa65',
  runtimePreseal: publication.runtimePreseal,
  publicationBinding: { bytes: 3872, sha256: '8cc5f053a7331bd7c31d73064269d2034485a0aa78b4a8c96128af2e3b0559ea' },
  controls: { groups: 8, passed: 8, controllerProcesses: 1, productCalls: 0, Workers: 0, receipt: resultReceipt },
  C18: { versioned: true, originalFailureCounterUnmeasured: true, registeredSnapshotIdentity: true, setupFailureExactIdentityOnce: true, disposalFulfillmentAbsentCleanupFailure: true, replacementStillRequiresOnePrepare: true, futureSemanticCalls: 'UNRUN' },
  unchanged: { sourceInputs: 309, emitted: 1012, package: publication.package, original: '8 PASS / 2 FAIL / 5 UNRUN; publication78;32roles', otherWorkflowBodies: 17, productionEdits: 0, frozenR3Layout: true, PUBLIC95: true },
  staticDelta: 'consumer -> failure -> node:util; explicit new origins, no full historical graph re-audit or nested-load proof',
  postguards, captures, inventory, accounting: { capturedBytes, ownedBytes, finalCaptureReserve: 1048576, finalWorkReserve: 4194304, units: 'logical owned bytes, not RSS; Git internal physical storage excluded', finalSelfWritesNotYetObserved: true },
  knownRoles: { throughFinalNode: 29, remaining: ['git-index-observation', 'git-add', 'git-commit'], maximumFinal: 32, qualification: 'Known-role accounting; final roles become actual only upon recorded wait/tool completion. No full descendants/group census.' },
  prospective: publication.workerProfile,
  actualAuthority: false, activationWindow: null, pending: 'Different review, final-slot preimport/root authorization binding and measured runtime ledger; no actual 15 yet',
};
fs.writeFileSync(path.join(scope, 'HANDOFF.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ utc: receipt.utc, pid: process.pid, controlsPassed: 8, productCalls: 0, postguards: postguards.length, capturedBytes, ownedBytes, actualAuthority: false }));
