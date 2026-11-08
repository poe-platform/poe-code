import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { hash, canonical, jsonBytes, readBound } from './io.mjs';

export const preparationCommit = '2b2a5fe48142dd94238d37ec77dfd736e2117e71';
export const cohortRoot = fileURLToPath(new URL('../cohorts/', import.meta.url));
export const sealHashes = Object.freeze({
  'SEAL.json': 'da99ce71943feec45a2bbbae6319e38fb1816522b5ffddbe55ae28b0716ce230',
  'AMENDMENT_V2_SEAL.json': '839d12181a024a6dcab928a5f1483ac3a9e10af8d04ab4bb9454dae02427e186',
});
export function loadCohorts(root = cohortRoot) {
  const payloads = new Map();
  for (const [name, sha256] of Object.entries(sealHashes)) {
    const seal = jsonBytes(readBound(root, name, { sha256 }, 65536).data);
    for (const record of seal.files) payloads.set(record.path, readBound(root, record.path, record, 16 * 1024 * 1024).data);
  }
  const original = jsonBytes(payloads.get('historical-224.json'));
  const breadth = jsonBytes(payloads.get('historical-breadth.json'));
  const profiles = jsonBytes(payloads.get('profiles.json'));
  const manifest = jsonBytes(payloads.get('manifest.json'));
  const amendment = jsonBytes(payloads.get('amendment-v2.json'));
  Object.assign(manifest.breadth, amendment.breadthOverrides);
  assert.equal(original.length, 224); assert.equal(breadth.length, 68);
  for (const rows of [original, breadth]) {
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
    for (const row of rows) {
      assert.equal(hash(canonical(row.recipe)), row.recipeCanonicalSha256);
      assert.equal(hash(canonical(row.input)), row.inputCanonicalSha256);
    }
  }
  for (const row of original) {
    assert.equal(hash(JSON.stringify(row.recipe)), row.capturedRecipeHash);
    for (const name of ['originalOracle', 'alignedOracle']) {
      assert.equal(row[name].observation.recipeHash, row.capturedRecipeHash);
      assert.equal(hash(canonical(row[name].observation)), row[name].canonicalSha256);
    }
  }
  for (const row of breadth) {
    const { inputSha256, ...effective } = row.recipe;
    assert.equal(hash(JSON.stringify(effective)), inputSha256);
  }
  const targets = breadth.filter(row => ['historical-unmeasured', 'additional-optional'].includes(row.recipe.cohort));
  const diagnostics = breadth.filter(row => row.recipe.cohort === 'direct-diagnostic');
  assert.equal(targets.length, 54); assert.equal(diagnostics.length, 7);
  assert.equal(breadth.length - targets.length - diagnostics.length, 7);
  assert.deepEqual(manifest.breadth.sharedControlIds, ['printf-positive', 'terminal-byte-control', 'curl-positive', 'vfs-census-control']);
  return { original, breadth, profiles, manifest, preparationCommit, seals: sealHashes };
}
export function planCases(cohorts) {
  const rows = [];
  for (const profile of ['original', 'aligned']) for (const [index, row] of cohorts.original.entries()) {
    for (const engine of index % 2 ? ['just-bash', 'virtual-bash'] : ['virtual-bash', 'just-bash']) rows.push({ profile, engine, id: row.id, specimen: row.recipe, expected: row[profile === 'original' ? 'originalOracle' : 'alignedOracle'].observation });
  }
  const primary = cohorts.breadth.filter(row => row.recipe.cohort !== 'direct-diagnostic');
  const order = [...primary.filter(row => row.recipe.cohort.startsWith('shared')), ...primary.filter(row => !row.recipe.cohort.startsWith('shared')), ...cohorts.breadth.filter(row => row.recipe.cohort === 'direct-diagnostic')];
  for (const row of order) for (const engine of ['virtual-bash', 'just-bash']) rows.push({ profile: 'breadth', engine, id: row.id, specimen: row.recipe });
  return rows;
}
