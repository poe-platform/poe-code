import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { owned, inventory, hash, git, save } from './prepare.mjs';
const current = () => inventory(owned).filter(entry => entry.path !== 'SEAL.json');
if (process.argv[2] === '--seal') {
  assert(!existsSync(join(owned, 'SEAL.json')));
  assert(!existsSync(join(owned, '.work')));
  save('SEAL.json', { candidate: '4f01c1593486c1abff3b007f9a3b16923b88559f', createdAt: new Date().toISOString(), inventory: current(), appendAware: true, scope: 'Own evidence tree only, excluding this seal. Original candidate src independently checked against immutable Git below.' });
}
const seal = JSON.parse(readFileSync(join(owned, 'SEAL.json')));
assert.deepEqual(current(), seal.inventory);
const sources = JSON.parse(readFileSync(join(owned, 'source-after.json'))).filter(entry => entry.type === 'file');
for (const entry of sources) assert.equal(entry.sha256, hash(git('show', `${seal.candidate}:src/${entry.path}`)), entry.path);
const cleanup = JSON.parse(readFileSync(join(owned, 'cleanup.json')));
assert(!existsSync(cleanup.work));
for (const entry of cleanup.externalNativeScratch) assert(!existsSync(entry.scratch));
assert.deepEqual(current(), seal.inventory);
console.log(JSON.stringify({ sealedEntries: seal.inventory.length, sourceFilesAuthenticated: sources.length, appendedEntriesChecked: true, cleanupChecked: true, productOrEvidenceWrites: process.argv[2] === '--seal' ? 'one new seal only' : false }));
