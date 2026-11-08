import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, inventory, save } from './old47/common.mjs';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const load = path => JSON.parse(readFileSync(join(owned, path)));
const entries = () => inventory(owned).filter(entry => entry.path !== 'SEAL.json');
const freeze = load('FREEZE.json');
for (const driver of freeze.drivers) assert.equal(hash(readFileSync(join(owned, driver.path))), driver.sha256);
for (const historical of freeze.historical) assert.deepEqual(inventory(join(owned, '..', historical.path)), historical.entries);
for (const name of ['cases.mjs', 'common.mjs', 'probe.mjs']) {
  const original = execFileSync('git', ['show', `${freeze.cohortCommit}:tests/commands/expr-stress/output-emergency-review-20260827/${name}`], { cwd: root });
  assert.equal(hash(readFileSync(join(owned, 'old47', name))), hash(original));
}
for (const label of ['baseline-01', 'candidate-01', 'candidate-02']) {
  const summary = load(`${label}/summary.json`);
  assert.equal(summary.old47.total, 47);
  assert.equal(summary.additional.total, 21);
  assert.equal(summary.old47.passed, label === 'baseline-01' ? 36 : 46);
  assert.equal(summary.additional.passed, label === 'baseline-01' ? 10 : 21);
  assert.equal(summary.suppliedCommit, label === 'baseline-01' ? freeze.baseline : 'c25e682a7baa2f2abf70cebf8c01d11d0ad5daee');
  if (label !== 'baseline-01') assert.deepEqual(summary.old47.failures.map(row => row.id), ['stdout-rejection-normal-quota']);
  for (const value of Object.values(summary.integrity)) assert.equal(value, true);
  for (const cohort of ['old47', 'additional']) {
    const result = load(`${label}/${cohort}-results.json`);
    assert.equal(result.passed, summary[cohort].passed);
    assert.equal(result.total, summary[cohort].total);
    assert.equal(result.rows.filter(row => row.passed).length, result.passed);
    assert.deepEqual(result.unhandledRejections, []);
    assert.deepEqual(result.mainThreadMatcherViolations, []);
    if (cohort === 'additional') assert.deepEqual(result.uncaughtExceptions, []);
    assert.equal(result.safetyTerminations, 0);
    assert.equal(result.activeAfterSafety, 0);
    assert(result.rows.every(row => row.activeAtSettlement === 0 && row.activeAfterCleanup === 0));
    const child = load(`${label}/${cohort}-process.json`);
    assert.equal(child.status, 0);
    assert.equal(child.stderr, '');
  }
  for (const phase of ['build', 'scoped-types']) assert.equal(load(`${label}/${phase}-process.json`).status, 0);
  assert.equal(load(`${label}/cleanup.json`).absent, true);
}
assert.deepEqual(load('candidate-01/built-before.json'), load('candidate-02/built-before.json'));
assert.deepEqual(load('SOURCE-AUDIT.json').sourceCommitChanges, ['src/commands/expr/index.ts']);
const mode = process.argv[2];
if (mode === '--seal') save(join(owned, 'SEAL.json'), { sealedAt: new Date().toISOString(), entries: entries(), detectsAppendedEntries: true, candidate: 'c25e682a7baa2f2abf70cebf8c01d11d0ad5daee' });
else {
  assert.equal(mode, '--verify');
  assert.deepEqual(entries(), load('SEAL.json').entries);
}
console.log('Integrity verified: baseline old47 36/47, new21 10/21; exact candidate old47 46/47, new21 21/21 twice. Original identity-oracle failure preserved.');
