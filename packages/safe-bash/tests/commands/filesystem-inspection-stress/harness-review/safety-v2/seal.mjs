import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCases, caseIds } from './cases.mjs';
import { verifySeal as originalSeal } from '../safety-v1/seal.mjs';

export const directory = dirname(fileURLToPath(import.meta.url));
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function verifySeal() {
  const original = originalSeal();
  const manifest = JSON.parse(readFileSync(join(directory, 'SEAL.json')));
  for (const entry of manifest.files) {
    const bytes = readFileSync(join(directory, entry.path));
    assert.equal(bytes.length, entry.bytes);
    assert.equal(digest(bytes), entry.sha256, entry.path);
  }
  const cases = JSON.parse(readFileSync(join(directory, 'derived-cases.json')));
  assert.deepEqual(cases, buildCases());
  assert.deepEqual(cases.map(entry => entry.id), caseIds);
  assert.deepEqual(manifest.caps, original.caps);
  assert.equal(manifest.maximumNewProductInvocations, 2);
  assert.equal(manifest.previousProductInvocations, 4);
  return { manifest, cases, caps: original.caps };
}
