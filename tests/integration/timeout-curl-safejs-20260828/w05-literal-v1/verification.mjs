import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { own as originalOwn, hashFile, read } from '../common.mjs';

export function guardOriginal() {
  assert.equal(hashFile(join(originalOwn, 'EVIDENCE-MANIFEST.json')), '5198c32b5c9793396c8db534419413168d6929d52baceaffea3fd5d7bc86da40', 'ORIGINAL_EVIDENCE_SEAL');
  for (const row of read(join(originalOwn, 'EVIDENCE-MANIFEST.json')).files) {
    const target = join(originalOwn, row.path), stat = fs.lstatSync(target);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'ORIGINAL_REGULAR_FILE');
    assert.equal(stat.size, row.bytes); assert.equal(stat.mode & 511, row.mode);
    assert.equal(hashFile(target), row.sha256, `ORIGINAL_UNCHANGED:${row.path}`);
  }
}
