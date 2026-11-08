import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url)));
const audit = read('./audit.json');
const native = read('./native-review.json');

test('all pinned proposal, canonical and historical inputs remain unchanged', () => {
  const result = spawnSync(process.execPath, [new URL('./review.mjs', import.meta.url).pathname, 'check'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('all 26 rows retain independently checked constituents and schedules', () => {
  assert.equal(audit.productImported, false);
  assert.equal(audit.rows.length, 26);
  assert.deepEqual(audit.classifications, { 'stale-policy': 19, 'diagnostic-mixed': 2, 'resource-mixed-composite': 1, 'newly-exposed-stale-assertion': 4 });
  assert.equal(audit.rows.reduce((total, row) => total + row.constituents.length, 0), 93);
  assert.equal(audit.rows.reduce((total, row) => total + row.retainedSchedules.executions, 0), 461);
  assert.equal(audit.rows[20].retainedSchedules.executions, 297);
  assert.equal(new Set(audit.rows.map(row => row.oldTestName)).size, 26);
  assert.equal(new Set(audit.rows.map(row => row.proposedReviewedName)).size, 26);
});

test('native evidence distinguishes exact argv, fd controls, neighbors and default stdin', () => {
  assert.equal(native.invocations, 222);
  assert.equal(native.results.length, 110);
  assert.ok(native.results.every(result => result.repeatIdentical));
  assert.equal(native.results.filter(result => result.matchesFrozen === false).length, 0);
  assert.equal(native.results.filter(result => result.matchesFrozen === true).length, 102);
  assert.equal(native.results.filter(result => result.matchesFrozen === null).length, 8);
  assert.equal(native.results.filter(result => result.route === 'binary-file-input-via-inherited-fd').length, 2);
  assert.equal(native.results.filter(result => result.kind === 'canonical-default-input-control').length, 6);
  assert.deepEqual(native.beforeFiles, native.afterFiles);
});

test('all byte mutants pass lossy comparison but fail raw equality', () => {
  assert.equal(audit.byteMutationDemonstrations.length, 14);
  for (const mutation of audit.byteMutationDemonstrations) {
    const expected = Buffer.from(mutation.expectedHex, 'hex');
    const actual = Buffer.from(mutation.mutantHex, 'hex');
    assert.equal(actual.toString(), expected.toString());
    assert.notDeepEqual(actual, expected);
  }
});

test('six implicit-null lookup mismatches have exact independent native controls', () => {
  assert.equal(audit.exactLookupMismatches.length, 6);
  for (const mismatch of audit.exactLookupMismatches) {
    assert.equal(mismatch.actualInputHex, '6e756c6c');
    assert.equal(mismatch.proofInputHex, '');
    const control = native.results.find(result => result.id === `${mismatch.id}-actual-default-input`);
    assert.equal(control.inputHex, mismatch.actualInputHex);
    assert.equal(control.matchesFrozen, true);
  }
});
