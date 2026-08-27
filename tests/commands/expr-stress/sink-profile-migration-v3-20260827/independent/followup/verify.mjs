import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { owned, hash, frozen, inventory, save } from '../lib.mjs';

const initialCommit = '0219616f7e2dc2f13aebc155933fd52fe1dfac9e';
const prefix = 'tests/commands/expr-stress/sink-profile-migration-v3-20260827/independent';
const oldSeal = JSON.parse(frozen(`${prefix}/SEAL.json`, initialCommit));
assert.equal(hash(readFileSync(join(owned, 'SEAL.json'))), hash(frozen(`${prefix}/SEAL.json`, initialCommit)));
const current = inventory(owned);
for (const [path, record] of Object.entries(oldSeal.entries)) assert.deepEqual(current[path], record, `immutable initial entry: ${path}`);
for (const path of Object.keys(current)) if (!(path in oldSeal.entries) && path !== 'SEAL.json') assert(path === 'followup' || path.startsWith('followup/') || path === 'quota-followup-01' || path.startsWith('quota-followup-01/'), `unapproved append: ${path}`);
const entries = () => Object.fromEntries(Object.entries(inventory(owned)).filter(([path]) => path !== 'followup/SEAL.json'));
if (process.argv[2] === '--seal') {
  assert(!existsSync(join(owned, 'followup/SEAL.json')));
  save(join(owned, 'followup/SEAL.json'), { sealedAt: new Date().toISOString(), initialCommit, entries: entries(), excludes: ['followup/SEAL.json (self)'], appendedEntriesDetected: true });
}
assert.deepEqual(entries(), JSON.parse(readFileSync(join(owned, 'followup/SEAL.json'))).entries);
const summary = JSON.parse(readFileSync(join(owned, 'quota-followup-01/SUMMARY.json')));
assert.equal(summary.preservedFalsePositives, 2); assert.equal(summary.correctedMutantsDetected, 7);
assert.equal(summary.counts.corrected.passed, 47); assert.equal(summary.counts.corrected.total, 47);
const freeze = JSON.parse(readFileSync(join(owned, 'quota-followup-01/FOLLOWUP-FREEZE.json')));
for (const record of freeze.recorded) assert.equal(hash(frozen(record.path, record.commit)), record.sha256);
for (const folder of ['run-02','quota-followup-01']) {
  const cleanup = JSON.parse(readFileSync(join(owned, folder, 'cleanup.json')));
  assert(cleanup.absent && !existsSync(cleanup.taskRoot));
}
console.log(JSON.stringify({ immutableInitialEntries: Object.keys(oldSeal.entries).length, currentEntries: Object.keys(entries()).length, finalQuota: '47/47', correctedQuotaMutants: 7, falsePositivesPreserved: 2, appendAware: true, allTaskRootsRemoved: true, writes: process.argv[2] === '--seal' ? ['followup/SEAL.json'] : [] }));
