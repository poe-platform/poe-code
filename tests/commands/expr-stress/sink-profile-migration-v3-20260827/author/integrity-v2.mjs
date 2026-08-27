import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { owned, hash, inventory, verifyInputs as verifyInitial } from './integrity.mjs';

export { owned, root, hash, git, inventory } from './integrity.mjs';
export const manifest = JSON.parse(readFileSync(join(owned, 'MANIFEST-v2.json')));
export function verifyInputs() {
  const initial = verifyInitial();
  const freeze = JSON.parse(readFileSync(join(owned, 'FREEZE-v2.json')));
  assert.equal(hash(readFileSync(join(owned, 'FREEZE.json'))), freeze.originalFreezeSha256);
  assert.equal(hash(readFileSync(join(owned, 'MANIFEST-v2.json'))), freeze.manifestSha256);
  for (const file of freeze.files) {
    const bytes = readFileSync(join(owned, file.path));
    assert.equal(bytes.length, file.bytes, file.path);
    assert.equal(hash(bytes), file.sha256, file.path);
  }
  const expected = Object.fromEntries(freeze.files.filter(file => file.path.startsWith('quota-identity-v2/')).map(file => [file.path.slice('quota-identity-v2/'.length), { kind: 'file', bytes: file.bytes, sha256: file.sha256 }]));
  assert.deepEqual(inventory(join(owned, 'quota-identity-v2')), expected);
  const delta = manifest.assertionDelta;
  const before = readFileSync(join(owned, delta.oldPath), 'utf8');
  const after = readFileSync(join(owned, delta.newPath), 'utf8');
  assert.equal(before.split(delta.insertionBefore).length, 2);
  assert.equal(after, before.replace(delta.insertionBefore, `${delta.insertedLine}\n${delta.insertionBefore}`));
  for (const path of ['cases.mjs', 'common.mjs']) assert.deepEqual(readFileSync(join(owned, 'quota-identity-v2', path)), readFileSync(join(owned, 'revised/quota', path)));
  return { ...initial, followupManifestSha256: freeze.manifestSha256, followupFreezeSha256: hash(readFileSync(join(owned, 'FREEZE-v2.json'))), targetOnlyPostExecutionAssertion: true };
}
