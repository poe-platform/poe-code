import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { blob, counts, directory, foreignStaging, frozenCases, git, gitHash, inherited, inventory, json, own, pins, repo, sha256 } from './common.mjs';
import { coverage } from './mapping.mjs';

const inputs = json(resolve(directory, 'INPUTS.json'));
const manifest = json(resolve(directory, 'MANIFEST.json'));
assert.deepEqual(inputs.pins, pins);
assert.deepEqual(inputs.counts, counts);
assert.deepEqual(inherited(), inputs.inheritedInventory);
assert.equal(inputs.original18.length, 18); assert.equal(inputs.ratification4.length, 4);
for (const path of inputs.original18) assert.deepEqual(blob(pins.freeze, path), blob(pins.binding, path));
for (const entry of [...inputs.inputs, ...inputs.protectedFiles]) {
  const bytes = blob(entry.commit, entry.path);
  assert.equal(gitHash('blob', bytes), entry.blob); assert.equal(bytes.length, entry.bytes); assert.equal(sha256(bytes), entry.sha256);
}
for (const entry of inputs.protectedFiles) assert.equal(sha256(readFileSync(resolve(repo, entry.path))), entry.sha256);
for (const entry of inputs.commits) { const bytes = git(['cat-file', 'commit', entry.commit]); assert.equal(gitHash('commit', bytes), entry.commit); assert.equal(sha256(bytes), entry.sha256); }
assert.deepEqual(inventory(resolve(repo, inputs.providerRoot)), inputs.providerInventoryBefore);
assert.deepEqual(foreignStaging(), inputs.foreignStagingBefore);
assert.deepEqual(manifest.foreignStagingAfter, inputs.foreignStagingBefore);
assert.deepEqual(inventory(directory, new Set(['MANIFEST.json'])), manifest.entries, 'preparation exact entry membership and hashes');
const files = Object.keys(inventory(directory)).filter(path => inventoryEntry(path));
function inventoryEntry(path) { return path === 'MANIFEST.json' || manifest.entries[path]?.kind === 'file'; }
assert.deepEqual(files.sort(), manifest.membership);
for (const original of [manifest.entries, inputs.inheritedInventory]) {
  assert.throws(() => assert.deepEqual({ ...original, 'SYNTHETIC-ADDITION-ONLY': { kind: 'directory', mode: 493 } }, original));
}
const data = await frozenCases();
const mapped = json(resolve(directory, 'COVERAGE.json'));
assert.deepEqual(mapped.rows, coverage(data));
assert.equal(mapped.invariants.length, 12); assert.equal(mapped.futureControls.length, 7);
assert.equal(mapped.types.positive, 10); assert.equal(mapped.types.negative, 10);
const result = json(resolve(directory, 'SYNTHETIC-RESULTS.json'));
assert.equal(result.classification, 'SYNTHETIC_PREPARATION_ONLY_POST_AUTHOR_RELEASE');
assert.equal(result.syntheticChecks, result.results.length);
assert(result.results.every(entry => entry.classification === 'SYNTHETIC_ONLY' && entry.status === 'pass'));
for (const field of ['productImports', 'productExecution', 'nativeRuns', 'providerRuns', 'typeCompilerRuns', 'buildPackInstall']) assert.equal(result[field], 0);
let commit;
if (process.argv[2]) {
  commit = process.argv[2]; assert(/^[a-f0-9]{40}$/u.test(commit));
  const paths = git(['ls-tree', '-r', '--name-only', commit, '--', own]).toString().trim().split('\n');
  assert.deepEqual(paths.sort(), manifest.membership.map(path => `${own}/${path}`).sort());
  for (const path of paths) assert.deepEqual(blob(commit, path), readFileSync(resolve(repo, path)));
  const delta = git(['diff-tree', '--no-commit-id', '--name-status', '-r', commit]).toString().trim().split('\n').sort();
  assert.deepEqual(delta, paths.map(path => `A\t${path}`).sort(), 'atomic additions only in owned preparation');
}
console.log(JSON.stringify({ classification: 'READ_ONLY_DATA_VERIFICATION_NOT_PRODUCT_EXECUTION', commit: commit ?? 'precommit-only', original18: 'unchanged', ratification4: 'unchanged', ownFiles: manifest.membership.length, rows: counts.total, types: '10+10 unchanged, NOT RUN', invariants: 12, futureControls: 7, syntheticChecks: result.syntheticChecks, future86PerLayout: 'NOT RUN', staging: 'preserved', selectedHistoricalRecords: inputs.protectedFiles.length, providerMembership: 'unchanged', candidateInspected: false, productExecution: false }, null, 2));
