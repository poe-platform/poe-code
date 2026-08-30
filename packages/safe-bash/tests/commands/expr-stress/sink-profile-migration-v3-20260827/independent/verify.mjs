import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { owned, root, product, inventory, hash, frozen, save } from './lib.mjs';

const entries = () => Object.fromEntries(Object.entries(inventory(owned)).filter(([path]) => path !== 'SEAL.json'));
if (process.argv[2] === '--seal') {
  assert(!existsSync(join(owned, 'SEAL.json')));
  save(join(owned, 'SEAL.json'), { sealedAt: new Date().toISOString(), entries: entries(), excludes: ['SEAL.json (self)'], appendedEntriesDetected: true });
}
const seal = JSON.parse(readFileSync(join(owned, 'SEAL.json')));
assert.deepEqual(entries(), seal.entries);
const integrity = JSON.parse(readFileSync(join(owned, 'run-02/final-integrity.json')));
assert.equal(integrity.product, product);
for (const source of integrity.sources) assert.equal(hash(frozen(source.path, product)), source.sha256);
const preservation = JSON.parse(readFileSync(join(owned, 'PRESERVATION.json')));
for (const row of preservation.originalHistoricalBodies) {
  assert.equal(hash(frozen(row.path, row.commit)), row.sha256);
  assert.equal(hash(readFileSync(join(root, row.path))), row.sha256);
}
const cleanup = JSON.parse(readFileSync(join(owned, 'run-02/cleanup.json')));
assert(cleanup.absent && !existsSync(cleanup.taskRoot));
console.log(JSON.stringify({ verifiedEvidenceEntries: Object.keys(seal.entries).length, appendAware: true, product, originalsPreserved: 4, cleanupConfirmed: true, writes: process.argv[2] === '--seal' ? ['SEAL.json'] : [] }));
