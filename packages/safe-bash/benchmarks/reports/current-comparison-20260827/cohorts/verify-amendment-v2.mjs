import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.argv.length, 2, 'No write or execution mode exists');
const directory = dirname(fileURLToPath(import.meta.url));
const maximumFileBytes = 16 * 1024 * 1024;
const maximumTotalBytes = 24 * 1024 * 1024;
const expectedV1SealSha256 = 'da99ce71943feec45a2bbbae6319e38fb1816522b5ffddbe55ae28b0716ce230';
const expectedV1ContentDigest = '46efb75be0663e4606cd616c7e8282ad3e01a367c72cd180703260a55f15d9df';
const cache = new Map();
let totalBytes = 0;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const digest = value => hash(JSON.stringify(canonical(value)));
function read(name) {
  assert.match(name, /^[A-Za-z0-9_.-]+$/);
  if (!cache.has(name)) {
    const filename = resolve(directory, name);
    const stat = lstatSync(filename);
    assert.ok(stat.isFile());
    assert.ok(stat.size <= maximumFileBytes);
    assert.ok(totalBytes + stat.size <= maximumTotalBytes);
    const bytes = readFileSync(filename);
    assert.equal(bytes.length, stat.size);
    totalBytes += bytes.length;
    cache.set(name, bytes);
  }
  return cache.get(name);
}
const json = name => JSON.parse(read(name));
function verifyFiles(seal, expectedCount) {
  assert.equal(seal.files.length, expectedCount);
  assert.equal(new Set(seal.files.map(file => file.path)).size, expectedCount);
  for (const file of seal.files) {
    const bytes = read(file.path);
    assert.equal(bytes.length, file.bytes, file.path);
    assert.equal(hash(bytes), file.sha256, file.path);
  }
}
assert.equal(hash(read('SEAL.json')), expectedV1SealSha256);
const v1Seal = json('SEAL.json');
assert.equal(v1Seal.contentDigest, expectedV1ContentDigest);
assert.equal(digest(v1Seal.files), expectedV1ContentDigest);
verifyFiles(v1Seal, 10);
const v2Seal = json('AMENDMENT_V2_SEAL.json');
assert.equal(v2Seal.baseSealSha256, expectedV1SealSha256);
assert.deepEqual(v2Seal.files.map(file => file.path), ['amendment-v2.json', 'AMENDMENT_V2.md', 'verify-amendment-v2.mjs']);
verifyFiles(v2Seal, 3);
assert.equal(digest(v2Seal.files), v2Seal.contentDigest);
const amendment = json('amendment-v2.json');
assert.equal(amendment.base.sealPath, 'SEAL.json');
assert.equal(amendment.base.sealSha256, expectedV1SealSha256);
assert.equal(amendment.base.contentDigest, expectedV1ContentDigest);
assert.equal(amendment.base.manifestPath, 'manifest.json');
const manifest = json('manifest.json');
const cases = json('historical-breadth.json');
const profiles = json('profiles.json');
const primary = cases.filter(row => row.section === 'cases');
const diagnostics = cases.filter(row => row.section === 'diagnostics');
const defaults = primary.filter(row => row.recipe.cohort === 'shared-control');
const optional = primary.filter(row => row.recipe.cohort === 'shared-optional-control');
const shared = primary.filter(row => ['shared-control', 'shared-optional-control'].includes(row.recipe.cohort));
const targets = primary.filter(row => ['historical-unmeasured', 'additional-optional'].includes(row.recipe.cohort));
const historicalOverlap = primary.filter(row => row.recipe.cohort === 'historical-measured-control');
const ids = rows => rows.map(row => row.id);
assert.deepEqual([targets.length, historicalOverlap.length, defaults.length, optional.length, shared.length, primary.length, diagnostics.length, cases.length], [54, 3, 3, 1, 4, 61, 7, 68]);
assert.equal(new Set(ids(cases)).size, cases.length);
assert.deepEqual(ids([...targets, ...historicalOverlap, ...shared]).sort(), ids(primary).sort());
assert.deepEqual(manifest.breadth.sharedControlIds, ids(defaults));
const curl = optional[0];
assert.equal(curl.id, 'curl-positive');
assert.equal(curl.recipe.configuration, 'loopback-network');
assert.equal(digest(curl.recipe), curl.recipeCanonicalSha256);
assert.equal(digest(curl.input), curl.inputCanonicalSha256);
function pointer(value, selector) {
  return selector.slice(1).split('/').reduce((parent, key) => parent[key], value);
}
function verifyControls(value) {
  assert.deepEqual(Object.keys(value.breadthOverrides).sort(), ['sharedControlIds', 'sharedDefaultControlIds', 'sharedOptionalControlIds']);
  assert.deepEqual(value.breadthOverrides.sharedControlIds, ids(shared));
  assert.deepEqual(value.breadthOverrides.sharedDefaultControlIds, ids(defaults));
  assert.deepEqual(value.breadthOverrides.sharedOptionalControlIds, ids(optional));
  const binding = value.optionalControlBinding;
  assert.equal(binding.id, curl.id);
  assert.equal(binding.caseSource, 'historical-breadth.json');
  assert.deepEqual(binding.caseSelector, { id: curl.id });
  assert.equal(binding.cohort, curl.recipe.cohort);
  assert.equal(binding.configuration, curl.recipe.configuration);
  assert.equal(binding.recipeCanonicalSha256, digest(curl.recipe));
  assert.equal(binding.inputCanonicalSha256, digest(curl.input));
  assert.equal(binding.profileSource, 'profiles.json');
  assert.equal(binding.oursConfigurationPointer, '/breadth/configurations/ours/loopback-network');
  assert.equal(binding.baselineConfigurationPointer, '/breadth/configurations/baseline/loopback-network');
  assert.equal(binding.networkPointer, '/breadth/network');
  for (const selector of [binding.oursConfigurationPointer, binding.baselineConfigurationPointer, binding.networkPointer]) {
    const selected = pointer(profiles, selector);
    assert.ok(selected && typeof selected === 'object' && Object.keys(selected).length > 0);
  }
}
verifyControls(amendment);
const negativeMutations = [
  value => { value.breadthOverrides.sharedControlIds = value.breadthOverrides.sharedControlIds.filter(id => id !== 'curl-positive'); },
  value => { value.breadthOverrides.sharedOptionalControlIds = []; },
  value => { value.breadthOverrides.sharedDefaultControlIds.push('curl-positive'); },
  value => { value.breadthOverrides.sharedControlIds.push('curl-positive'); },
  value => { value.optionalControlBinding.configuration = 'default'; },
  value => { value.optionalControlBinding.recipeCanonicalSha256 = '0'.repeat(64); },
];
for (const mutate of negativeMutations) {
  const modified = structuredClone(amendment);
  mutate(modified);
  assert.throws(() => verifyControls(modified), assert.AssertionError);
}
const counters = amendment.historicalCountersUnchanged;
assert.deepEqual(counters, {
  targetRecipes: targets.length,
  historicalOverlapControls: historicalOverlap.length,
  sharedDefaultControls: defaults.length,
  sharedOptionalControls: optional.length,
  sharedControlsCombined: shared.length,
  primaryRecipes: primary.length,
  diagnosticRecipes: diagnostics.length,
  totalRecipes: cases.length,
  distinctCaseEngineOutcomes: manifest.breadth.distinctCaseEngineOutcomes,
  targetPositives: manifest.breadth.exactTargetPositives,
  allPrimaryPositives: manifest.breadth.allPrimaryPositiveCounts,
});
assert.equal(counters.distinctCaseEngineOutcomes, 136);
const proposals = json('proposed-holdouts.json').cases;
const clarification = amendment.preparationClarifications;
assert.deepEqual(clarification.knownIntendedAdditions, ['tree', 'file']);
assert.equal(clarification.sealedProposedRecipeCount, proposals.length);
assert.equal(proposals.length, 24);
assert.deepEqual(clarification.sealedProposedTargetNames, [...new Set(proposals.map(row => row.name))].sort());
assert.equal(clarification.sealedProposedTargetNameCount, 12);
assert.equal(clarification.coversAll70, false);
assert.equal(clarification.candidateIdentityProvidedByThisAmendment, null);
assert.equal(clarification.newRecipes, 0);
assert.equal(clarification.newNativeExpectations, 0);
assert.equal(clarification.newNameInference, false);
assert.ok(proposals.every(row => row.nativeExpected === null && row.candidateBinding === null && !clarification.knownIntendedAdditions.includes(row.name)));
assert.equal(amendment.execution.authorized, false);
assert.ok(Object.entries(amendment.execution).every(([key, value]) => key === 'authorized' || value === 0));
console.log(JSON.stringify({
  status: 'PASS-static-amendment-only',
  originalSealSha256: expectedV1SealSha256,
  originalPayloadHashesVerified: v1Seal.files.length,
  amendmentSha256: hash(read('amendment-v2.json')),
  amendmentSealSha256: hash(read('AMENDMENT_V2_SEAL.json')),
  effectiveBreadthFields: amendment.breadthOverrides,
  historicalCountersUnchanged: counters,
  intendedAdditions: clarification.knownIntendedAdditions,
  existingProposals: { recipes: proposals.length, targetNames: clarification.sealedProposedTargetNameCount, coversAll70: false },
  staticNegativeControlsPassed: negativeMutations.length,
  totalInputBytes: totalBytes,
  execution: amendment.execution,
}, null, 2));
