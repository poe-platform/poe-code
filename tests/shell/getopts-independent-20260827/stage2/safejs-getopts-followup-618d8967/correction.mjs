import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { own, work, hash, json, git, relativeOwn, inventory, verifyFreeze } from './common.mjs';

export const originalFreezeCommit = '5b3c6c08ecb21a05db47fb4c191f693d32e1dc78';
export const correctedRoot = path.join(work, 'run-v2');
export const correctionFiles = ['CORRECTION-v2.md', 'child-v2.mjs', 'correction.mjs', 'prepare-v2.mjs', 'run-v2.mjs', 'finish-v2.mjs', 'verify-v2.mjs'];
export const originalImmutable = () => inventory(work, name => ['run/logs', 'run/tmp', 'run/home', 'run-v2'].some(prefix => name === prefix || name.startsWith(prefix + '/')));
export const correctedImmutable = () => inventory(correctedRoot, name => ['logs', 'tmp', 'home'].some(prefix => name === prefix || name.startsWith(prefix + '/')));
export function verifyCorrection(commit) {
  verifyFreeze(originalFreezeCommit);
  const bytes = fs.readFileSync(path.join(own, 'FREEZE-v2.json'));
  assert.deepEqual(bytes, git('show', `${commit}:${relativeOwn}/FREEZE-v2.json`));
  const correction = json(path.join(own, 'FREEZE-v2.json'));
  assert.equal(correction.originalFreezeCommit, originalFreezeCommit);
  assert.deepEqual(Object.keys(correction.inputs).sort(), [...correctionFiles].sort());
  for (const [name, expected] of Object.entries(correction.inputs)) {
    const input = fs.readFileSync(path.join(own, name));
    assert.equal(hash(input), expected, name);
    assert.deepEqual(input, git('show', `${commit}:${relativeOwn}/${name}`));
  }
  return correction;
}
