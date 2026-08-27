import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import test from 'node:test';
import { owned, root, sha256, transport } from './support.mjs';

const read = async name => JSON.parse(await readFile(resolve(owned, name)));
const inputs = await read('inputs.json'), native = await read('native-role-corrected.json'), initial = await read('native-frozen.json'), baseline = await read('baseline-6e3e316.json'), negative = await read('negative-controls.json');
test('original routed denominator is 25 historical plus two classification, not 29', () => {
  assert.equal(inputs.routed.length, 27);
  assert.equal(inputs.routed.filter(row => row.classification === 'historical-bash32-profile').length, 16);
  assert.equal(inputs.routed.filter(row => row.classification === 'bash-native-profile').length, 9);
  assert.equal(inputs.routed.filter(row => row.classification === 'registered-command-label').length, 2);
  assert.equal(inputs.routed.filter(row => row.path.endsWith('/current-gaps/compatibility.test.ts')).length, 4);
  assert.equal(inputs.routed.filter(row => row.path.endsWith('/differential.test.ts')).length, 5);
});
test('all original inputs retain byte-identical Git blobs', async () => {
  for (const [path, proof] of Object.entries(inputs.inputs)) {
    assert.equal(sha256(await readFile(resolve(root, path))), proof.sha256);
    assert.equal(sha256(execFileSync('/usr/bin/git', ['cat-file', 'blob', proof.blob], { cwd: root })), proof.sha256);
  }
});
test('whole native controls preserve both profiles and the setup-defect history', () => {
  assert.equal(inputs.rows.length, 169);
  for (const capture of [initial, native]) {
    assert.equal(capture.total, 338); assert.deepEqual(capture.before, capture.after);
    for (const profile of capture.profiles) { assert.deepEqual(profile.rows.map(row => row.id), inputs.rows.map(row => row.id)); for (const row of profile.rows) assert.ok(transport(row.result)); }
  }
  for (const profile of native.profiles) {
    assert.ok(profile.shPath.endsWith('/sh'));
    assert.equal(profile.nestedRoleControl.result.status, 0);
    assert.match(Buffer.from(profile.nestedRoleControl.result.stdout, 'base64').toString(), /^posix\s+on$/mu);
  }
  assert.ok(initial.profiles.every(profile => !profile.shPath.endsWith('/sh')));
});
test('all 257 baseline slots are explicit and source guarded', () => {
  assert.equal(baseline.records.length, 257);
  assert.equal(baseline.records.filter(row => row.context === 'canonical').length, 169);
  assert.equal(baseline.records.filter(row => row.context === 'original').length, 88);
  for (const row of baseline.records) {
    assert.equal(row.valid, true, row.id);
    assert.ok(transport(row.run)); assert.deepEqual(row.issues, []);
    assert.deepEqual(baseline.manifests[row.before], baseline.manifests[row.after]);
    for (const load of baseline.manifests[row.loads]) { assert.equal(load.valid, true); assert.equal(load.liveSource, false); if (load.category === 'product') assert.equal(load.hash, baseline.committed[load.key].sha256); }
  }
  assert.equal(baseline.stable, true); assert.equal(baseline.originalInputGuard, true);
});
test('exact tuple comparisons retain mode and byte losses without normalization', () => {
  for (const row of baseline.records) for (const comparison of row.comparisons) {
    const reference = native.profiles.find(profile => profile.id === comparison.profile).rows.find(reference => reference.id === row.id);
    assert.deepEqual(comparison.expected, { stdout: reference.result.stdout, stderr: reference.result.stderr, status: reference.result.status, effects: reference.effects });
    for (const field of ['stdout', 'stderr', 'status', 'effects']) assert.equal(comparison.exactFields[field], isDeepStrictEqual(row.result.actual?.[field], comparison.expected[field]));
    assert.equal(comparison.rawExact, Object.values(comparison.exactFields).every(Boolean));
  }
});
test('the independent checker rejects all twelve mutations without a candidate claim', async () => {
  assert.equal(negative.validControls, 2); assert.equal(negative.mutants.length, 12);
  assert.ok(negative.mutants.every(row => row.rejected));
  assert.equal(negative.checkerSha256, sha256(await readFile(resolve(owned, 'review-checks.mjs'))));
});
test('cleanup receipt binds the durable raw archive proof', async () => {
  const receipt = await read('baseline-cleanup.json');
  assert.equal(receipt.rawSha256, sha256(await readFile(resolve(owned, 'baseline-6e3e316.json'))));
  assert.equal(receipt.directoryRemoved, true); assert.equal(receipt.groupsAbsent, true);
  assert.equal(baseline.cleanup.savedBeforeRemoval, true);
});
test('the preparation manifest freezes every owned input, plan and observation', async () => {
  const manifest = await read('freeze.json');
  assert.equal(manifest.authorCandidateInspected, false);
  for (const [name, expected] of Object.entries(manifest.files)) assert.equal(sha256(await readFile(resolve(owned, name))), expected, name);
});
