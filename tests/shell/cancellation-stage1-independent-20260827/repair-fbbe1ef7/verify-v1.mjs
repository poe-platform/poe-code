import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { here, hash, inventory, historicalMembership, verifySeal } from './archive-v1.mjs';

const history = historicalMembership();
for (const name of ['evidence-v1', 'replay-v1']) {
  const directory = path.join(here, name);
  const expected = JSON.parse(readFileSync(path.join(directory, 'evidence-manifest.json')));
  assert.deepEqual(inventory(directory).filter(item => item.path !== 'evidence-manifest.json'), expected,
    `${name}: complete bytes and membership including additions`);
  verifySeal(JSON.parse(readFileSync(path.join(directory, 'seal.json'))));
}
const append = JSON.parse(readFileSync(path.join(here, 'append-manifest-v2.json')));
assert.deepEqual(inventory(here).filter(item => item.path !== 'append-manifest-v2.json'), append.entries,
  'new append layer complete bytes and membership including additions');
assert.equal(hash(readFileSync(path.join(here, '../final-manifest-v2.json'))), append.historicalManifestSha256);
console.log(JSON.stringify({ historyEntries: history.length, exactOldLayerExclusion: 'repair-fbbe1ef7/',
  appendEntries: append.entries.length, captureAndReplayAuthenticated: true, appendProofIncludesNewEntries: true }, null, 2));
