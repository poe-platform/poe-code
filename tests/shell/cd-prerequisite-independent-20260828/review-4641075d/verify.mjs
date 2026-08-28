import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { directory, foreignStaging, git, inventory, objectHash, own, repo, sha } from './bind.mjs';
import { verify as verifyArchive } from './archive.mjs';

const json = name => JSON.parse(readFileSync(resolve(directory, name)));
const preserved = json('CONTROL-IDENTITY.json');
for (const entry of [...preserved.files, ...preserved.priorHistorical, ...preserved.author]) assert.equal(sha(readFileSync(resolve(repo, entry.path))), entry.sha256, entry.path);
assert.equal(preserved.files.length, 41);
const oldInputs = json('../executor-preparation-v1/INPUTS.json');
assert.deepEqual(inventory(resolve(directory, '..'), new Set(['executor-preparation-v1', 'review-4641075d'])), oldInputs.inheritedInventory);
const oldManifest = json('../executor-preparation-v1/MANIFEST.json');
assert.deepEqual(inventory(resolve(directory, '../executor-preparation-v1'), new Set(['MANIFEST.json'])), oldManifest.entries);
assert.deepEqual(inventory(resolve(repo, oldInputs.providerRoot)), preserved.providerInventory);
assert.deepEqual(foreignStaging(), preserved.foreignStaging);
const index = JSON.parse(gunzipSync(readFileSync(resolve(directory, 'ARCHIVE-INDEX.json.gz'))));
const wanted = [
  ['source', 'attempt-02', 'records/source-cases-result.json'],
  ['installed', 'continuation-03', 'records/installed-cases-result.json'],
  ['moved', 'continuation-03', 'records/moved-cases-result.json'],
  ['sourceTypes', 'continuation-01', 'records/source-types-result.json'],
  ['installedTypes', 'continuation-03', 'records/installed-types-result.json'],
  ['movedTypes', 'continuation-03', 'records/moved-types-result.json'],
  ['auxiliary', 'auxiliary-01', 'records/SUMMARY.json'],
  ['loads', 'load-controls-01', 'records/SUMMARY.json'],
  ['package', 'continuation-03', 'records/package.json'],
];
const collected = new Map(wanted.map(([, root, path]) => [index.roots[root][path].sha256, []]));
await verifyArchive(false, collected);
const records = Object.fromEntries(wanted.map(([name, root, path]) => [name, JSON.parse(collected.get(index.roots[root][path].sha256))]));
const frozen = await import('../cases-v1.mjs'); const ids = [...frozen.cases, ...frozen.diagnosticCases].map(row => row.id);
for (const mode of ['source', 'installed', 'moved']) {
  const result = records[mode]; assert.deepEqual(result.results.map(row => row.id), ids); assert.equal(result.results.length, 86); assert.equal(result.stopped, false);
  assert(result.results.every(row => row.status.startsWith('public-pass') && row.cleanup === 'clean'));
  const types = records[`${mode}Types`]; assert.equal(types.positive, 10); assert.equal(types.negative, 10); assert.equal(types.diagnostics.length, 10); assert.equal(types.inversions.length, 10); assert(types.inversions.every(entry => entry.remaining === 9));
  const modulePaths = new Set(result.loaded.filter(entry => entry.path.includes(mode === 'source' ? '/source/src/' : '/node_modules/virtual-bash/dist/')).map(entry => entry.path)); assert.equal(modulePaths.size, 207);
}
assert.equal(records.auxiliary.mutants.length, 2); assert(records.auxiliary.mutants.every(row => row.status === 'semantic-mutant-killed' && row.captureStatus === 1)); assert.equal(records.auxiliary.regression.tests, 20); assert.equal(records.auxiliary.regression.pass, 20);
assert.equal(records.loads.results.length, 12); assert(records.loads.results.every(row => row.status === 'pass')); assert(records.loads.finalOriginalInstalledAbsent && records.loads.finalMovedUnchanged);
assert.equal(Object.values(records.package.entries).filter(entry => entry.kind === 'file').length, 846);
const result = json('RESULT.json'); assert.equal(result.package.sha256, records.package.sha256); assert.equal(result.invariants.length, 12); assert.equal(result.integrationControls.length, 7); assert.equal(result.privateHelperFixturesExecuted, 0);
assert(result.recordedSettlements.every(entry => entry.naturalSettlement && entry.cleanupClean));
assert(result.layouts.every(entry => entry.publicAssertions.pass === 86 && entry.frozenAdapterQualification.fullyBound === 85 && JSON.stringify(entry.frozenAdapterQualification.scriptedOnly) === '["L24"]'));
const proof = JSON.parse(gunzipSync(readFileSync(resolve(directory, 'TREE-PROOF-FULL.json.gz'))));
const composition = JSON.parse(gunzipSync(readFileSync(resolve(directory, 'composition.json.gz'))));
for (const entry of proof.commits) { const bytes = Buffer.from(entry.raw); assert.equal(objectHash('commit', bytes), entry.commit); assert.equal(sha(bytes), entry.sha256); }
const trees = new Map();
for (const [hash, value] of Object.entries(proof.proof)) {
  const bytes = Buffer.from(value, 'base64'); assert.equal(objectHash('tree', bytes), hash); const entries = new Map(); let offset = 0;
  while (offset < bytes.length) { const end = bytes.indexOf(0, offset); assert(end > offset); const header = bytes.subarray(offset, end).toString(); const space = header.indexOf(' '); entries.set(header.slice(space + 1), { mode: header.slice(0, space), hash: bytes.subarray(end + 1, end + 21).toString('hex') }); offset = end + 21; }
  assert.equal(offset, bytes.length); trees.set(hash, entries);
}
const lookup = (root, path) => { let current = root; let entry; for (const name of path.split('/')) { entry = trees.get(current)?.get(name); assert(entry, `${root}:${path}:${name}`); current = entry.hash; } return entry; };
const paths = [];
const walk = (hash, prefix) => { for (const [name, entry] of trees.get(hash)) if (entry.mode === '40000') walk(entry.hash, `${prefix}${name}/`); else paths.push(`${prefix}${name}`); };
walk(lookup(proof.candidateComposedTree, 'src').hash, 'src/'); paths.push('package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'README.md');
assert.deepEqual(paths.sort(), Object.keys(composition.files).sort()); assert.equal(paths.length, 265);
for (const [path, entry] of Object.entries(composition.files)) { const bytes = Buffer.from(entry.base64, 'base64'); assert.equal(sha(bytes), entry.sha256); assert.equal(objectHash('blob', bytes), entry.blob); const linked = lookup(proof.candidateComposedTree, path); assert.equal(linked.hash, entry.blob); assert.equal(parseInt(linked.mode.slice(-3), 8), entry.mode); }
for (const entry of proof.extraPaths) { const commit = proof.commits.find(item => item.commit === entry.commit); assert(commit); const root = /^tree ([a-f0-9]{40})$/mu.exec(commit.raw)[1]; assert.equal(lookup(root, entry.path).hash, entry.blob); }
const sourceReview = json('SOURCE-REVIEW.json'); assert.equal(sourceReview.otherMembers.length, 58); assert.equal(sourceReview.nonCdBuiltinStatements, 13); assert(sourceReview.nonCdBuiltinStatementsByteIdentical && sourceReview.otherTopLevelStatementsIdenticalExceptFsErrorImport);
assert.equal(sha(gunzipSync(readFileSync(resolve(directory, 'baseline-runtime.ts.txt.gz')))), sourceReview.baselineRuntime.sha256);
let sealed = false;
if (process.argv[2] !== '--unsealed') {
  const manifest = json('MANIFEST.json'); assert.deepEqual(inventory(directory, new Set(['MANIFEST.json'])), manifest.entries); sealed = true;
  const cleanup = json('CLEANUP.json'); assert(cleanup.archiveVerifiedBeforeRemoval && cleanup.allRemovedRootsAbsent); for (const root of cleanup.removedOnly) assert(!existsSync(resolve(directory, root)));
  assert.throws(() => assert.deepEqual({ ...manifest.entries, 'SYNTHETIC-ADDITION': { kind: 'directory', mode: 493 } }, manifest.entries));
  if (process.argv[2]) {
    const commit = process.argv[2]; assert(/^[a-f0-9]{40}$/u.test(commit));
    const files = git(['ls-tree', '-r', '--name-only', commit, '--', own]).toString().trim().split('\n').sort(); assert.deepEqual(files, manifest.files.map(name => `${own}/${name}`).sort());
    for (const path of files) assert.equal(sha(git(['show', `${commit}:${path}`])), sha(readFileSync(resolve(repo, path))));
    const commits = git(['log', '--format=%H', commit, '--', own]).toString().trim().split('\n'); for (const ownCommit of commits) assert(git(['diff-tree', '--no-commit-id', '--name-only', '-r', ownCommit]).toString().trim().split('\n').every(path => path.startsWith(`${own}/`)), ownCommit);
  }
}
console.log(JSON.stringify({ classification: 'read-only evidence audit, no product execution', sealed, publicPerLayout: '86 pass /0 fail /0 blocked /0 untested', qualification: '85 fully bound adapter qualifiers + L24 scripted-only each', typesPerLayout: '10positive10negative10inversions', modulesPerLayout: 207, packageFiles: 846, actualImportNegatives: 12, semanticMutantsKilled: 2, existingRegressionsPassed: 20, invariants: 12, controls: 7, privateHelperFixtures: 0, sourceFilesProvedWithoutLooseSourceObjects: 265, preservedControls: 41, foreignStaging: 'preserved' }, null, 2));
