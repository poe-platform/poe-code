import assert from 'node:assert/strict';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, owned, sha256, verifyFrozen } from './review.mjs';

export function inventory(directory, prefix = '') {
  return readdirSync(directory).sort().flatMap(name => {
    const path = join(directory, name), relative = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(path); assert(!stat.isSymbolicLink(), `unexpected symlink: ${path}`);
    return stat.isDirectory() ? inventory(path, relative) : [{ path: relative, sha256: sha256(readFileSync(path)) }];
  });
}
export function verifyList(actual, expected) {
  assert.deepEqual(actual.map(item => item.path), expected.map(item => item.path), 'file inventory changed, including added entries');
  for (let index = 0; index < actual.length; index++) assert.equal(actual[index].sha256, expected[index].sha256, `bytes changed: ${actual[index].path}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync(join(root, owned, 'execution-manifest.json')));
  const actual = inventory(join(root, owned)).filter(item => item.path !== 'execution-manifest.json');
  verifyList(actual, manifest.files);
  verifyFrozen();
  console.log(JSON.stringify({ verified: true, files: actual.length, appendedEntriesChecked: true, source: 'Git-pinned original and extension freezes plus externally Git-bound execution manifest', candidateReexecuted: false, acceptance: 'Integrity only; recorded candidate acceptance remains FAIL' }, null, 2));
}
