import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, inventory, save } from './common.mjs';
import { cases, constants } from './cases.mjs';

const owned = dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2];
assert(['--seal', '--verify'].includes(mode));
const freeze = JSON.parse(readFileSync(join(owned, 'FREEZE.json')));
for (const driver of freeze.drivers) assert.equal(hash(readFileSync(join(owned, driver.path))), driver.sha256);
assert.equal(hash(JSON.stringify(cases)), freeze.casesSha256);
assert.equal(Buffer.byteLength(constants.emergency), 34);
assert.equal(Buffer.byteLength(constants.syntax), 44);
assert.equal(Buffer.from(constants.emergency).toString('hex'), constants.emergencyHex);
for (const old of freeze.historical) assert.deepEqual(inventory(join(owned, '..', old.path)), old.entries);
const historical = JSON.parse(readFileSync(join(owned, '../fixture-output-contract-20260827/before-01/runtime-frozen.json')));
assert.equal(historical.rows.length, 12);
assert.equal(historical.rows.filter(row => row.passed).length, 11);
const results = ['run01', 'run02'].map(run => JSON.parse(readFileSync(join(owned, run, 'results.json'))));
for (const result of results) {
  assert.equal(result.total, 47);
  assert.equal(result.passed, 36);
  assert.equal(result.rows.filter(row => row.passed).length, 36);
  assert.equal(result.safetyTerminations, 0);
  assert.equal(result.activeAfterSafety, 0);
  assert.deepEqual(result.unhandledRejections, []);
  assert.deepEqual(result.mainThreadMatcherViolations, []);
  assert.deepEqual(result.rows.map(row => row.input), cases);
}
const comparable = result => result.rows.map(row => ({ input: row.input, actual: row.actual, checks: row.checks, jobs: row.jobs.map(job => job.kind), passed: row.passed }));
assert.deepEqual(comparable(results[0]), comparable(results[1]));
for (const path of ['archive-before.json', 'built-before.json']) assert.deepEqual(readFileSync(join(owned, 'run01', path)), readFileSync(join(owned, 'run02', path)));
const entries = inventory(owned).filter(entry => entry.path !== 'SEAL.json');
if (mode === '--seal') save(join(owned, 'SEAL.json'), { sealedAt: new Date().toISOString(), candidate: freeze.candidate, entries,
  result: '36/47 twice; FAIL, production change required. Historical 11/12 unchanged.', appendAware: true });
else assert.deepEqual(entries, JSON.parse(readFileSync(join(owned, 'SEAL.json'))).entries);
console.log('Integrity verified; 36/47 twice remains FAIL; historical 11/12 preserved.');
