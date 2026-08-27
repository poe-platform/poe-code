import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const preparation = resolve(directory, '..');
const repository = resolve(directory, '../../../..');
const caps = { perFileBytes: 8 * 1024 * 1024, totalBytes: 32 * 1024 * 1024, gitTimeoutMs: 10000 };
const cache = new Map();
const receipts = [];
let totalBytes = 0;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, function (key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]])) : item;
});
function account(bytes, name) {
  totalBytes += bytes.length;
  assert.ok(bytes.length <= caps.perFileBytes && totalBytes <= caps.totalBytes, `read cap: ${name}`);
  receipts.push({ name, bytes: bytes.length, sha256: hash(bytes) });
  return bytes;
}
function read(filename) {
  if (!cache.has(filename)) {
    assert.ok(statSync(filename).size <= caps.perFileBytes, `file cap: ${filename}`);
    cache.set(filename, account(readFileSync(filename), filename));
  }
  return cache.get(filename);
}
const json = relative => JSON.parse(read(resolve(preparation, relative)));
for (const [manifest, root] of [['cohorts/SEAL.json', resolve(preparation, 'cohorts')], ['provenance/MANIFEST.json', repository]]) {
  for (const item of json(manifest).files) {
    const bytes = read(resolve(root, item.path));
    assert.equal(bytes.length, item.bytes);
    assert.equal(hash(bytes), item.sha256, item.path);
  }
}
const manifest = json('cohorts/manifest.json');
const artifacts = json('cohorts/artifact-manifest.json').artifacts;
const git = args => execFileSync('git', args, { cwd: repository, timeout: caps.gitTimeoutMs, maxBuffer: caps.perFileBytes });
function captured(revision, suffix) {
  const matches = artifacts.filter(item => item.revision === revision && item.path.endsWith(suffix));
  assert.equal(matches.length, 1, suffix);
  const item = matches[0];
  assert.ok(item.bytes <= caps.perFileBytes);
  assert.equal(git(['rev-parse', `${revision}:${item.path}`]).toString().trim(), item.gitBlob);
  assert.equal(Number(git(['cat-file', '-s', item.gitBlob]).toString()), item.bytes);
  const bytes = account(git(['cat-file', 'blob', item.gitBlob]), `${revision}:${item.path}`);
  assert.equal(bytes.length, item.bytes);
  assert.equal(hash(bytes), item.sha256);
  return JSON.parse(bytes);
}
const original = captured(manifest.refs.curie, '/native-corrected/native.json');
const aligned = captured(manifest.refs.aligned, '/native-scratch-aligned/native.json');
const old = json('cohorts/historical-224.json');
assert.equal(old.length, 224);
assert.equal(new Set(old.map(row => row.id)).size, 224);
assert.deepEqual(old.map(row => row.recipe), original.recipes);
assert.deepEqual(original.recipes, aligned.recipes);
assert.deepEqual(original.performanceRecipes, aligned.performanceRecipes);
assert.equal(original.performanceRecipes.length, 4);
assert.equal(original.observations.length, 228);
assert.equal(aligned.observations.length, 228);
for (const row of old) {
  assert.equal(row.recipeCanonicalSha256, hash(canonical(row.recipe)));
  assert.equal(row.capturedRecipeHash, hash(JSON.stringify(row.recipe)));
  assert.deepEqual(row.input, { cwd: '/fixture', files: row.recipe.files, stdinBase64: row.recipe.stdin, directories: row.recipe.directories, fileModes: row.recipe.fileModes, fileTimes: row.recipe.fileTimes, symlinks: {} });
  assert.equal(row.inputCanonicalSha256, hash(canonical(row.input)));
  assert.deepEqual(row.originalOracle.observation, original.observations.find(item => item.id === row.id));
  assert.deepEqual(row.alignedOracle.observation, aligned.observations.find(item => item.id === row.id));
  for (const asset of row.staticCoverage.assets) {
    const bytes = Buffer.from(asset.role === 'stdin' ? row.input.stdinBase64 : row.input.files[asset.role.slice(5)], 'base64');
    assert.equal(bytes.length, asset.byteLength);
    assert.equal(hash(bytes), asset.sha256);
  }
}
const deltas = original.observations.filter(before => canonical(before) !== canonical(aligned.observations.find(after => after.id === before.id)));
assert.deepEqual(deltas.map(row => row.id), ['command/patch/dry-run']);
const deltaAfter = aligned.observations.find(row => row.id === deltas[0].id);
assert.deepEqual(Object.keys(deltas[0]).filter(key => canonical(deltas[0][key]) !== canonical(deltaAfter[key])), ['entries']);
const scores = {};
for (const [profile, revision, suffix] of [
  ['frozenBd2cac', manifest.refs.curie, '/corrected-bd2cacb/functional.json'],
  ['replayOriginal', manifest.refs.replay, '/original/functional.json'],
  ['replayAligned', manifest.refs.replay, '/scratch-aligned/functional.json'],
]) {
  const historical = captured(revision, suffix);
  assert.equal(historical.length, 224);
  for (const row of old) for (const engine of ['virtual-bash', 'just-bash']) {
    assert.deepEqual(row.historicalResults[profile][engine], historical.find(item => item.id === row.id)[engine]);
  }
  scores[profile] = Object.fromEntries(['virtual-bash', 'just-bash'].map(engine => [engine, historical.filter(row => row[engine].status === 'pass').length]));
}
assert.deepEqual(scores, { frozenBd2cac: { 'virtual-bash': 206, 'just-bash': 155 }, replayOriginal: { 'virtual-bash': 222, 'just-bash': 155 }, replayAligned: { 'virtual-bash': 223, 'just-bash': 155 } });
const groups = Object.fromEntries(['command', 'kernel', 'composition', 'network'].map(group => [group, old.filter(row => row.recipe.group === group).length]));
assert.deepEqual(groups, { command: 168, kernel: 36, composition: 12, network: 8 });
const breadth = json('cohorts/historical-breadth.json');
const breadthSource = captured(manifest.refs.faraday, '/attempt-002/execution-inputs.json');
const breadthReview = captured(manifest.refs.faradayReview, '/review-matrix.json');
assert.deepEqual(breadth.map(row => row.recipe), [...breadthSource.cases, ...breadthSource.diagnostics]);
assert.equal(breadth.filter(row => row.section === 'cases').length, 61);
assert.equal(breadth.filter(row => row.section === 'diagnostics').length, 7);
assert.equal(new Set(breadth.map(row => row.id)).size, 68);
for (const row of breadth) {
  assert.deepEqual(row.review, breadthReview.observations.find(item => item.id === row.id));
  assert.deepEqual(row.oracle.expected, row.recipe.expected);
}
const targets = breadth.filter(row => ['historical-unmeasured', 'additional-optional'].includes(row.recipe.cohort));
assert.equal(targets.length, 54);
assert.deepEqual(['ours', 'baseline'].map(engine => targets.filter(row => row.review[engine].operationalCredit).length), [0, 47]);
assert.deepEqual(['ours', 'baseline'].map(engine => breadth.filter(row => row.section === 'cases' && row.review[engine].operationalCredit).length), [7, 53]);
assert.equal(breadth.flatMap(row => [row.review.ours, row.review.baseline]).filter(result => result.normalChild).length, 135);
assert.equal(breadthReview.dispatchEvidence.filter(row => row.missingConfirmed).length, 54);
const holdouts = json('cohorts/proposed-holdouts.json').cases;
assert.equal(holdouts.length, 24);
assert.equal(new Set(holdouts.map(row => row.name)).size, 12);
for (const row of holdouts) {
  assert.equal(row.nativeExpected, null);
  assert.equal(row.candidateBinding, null);
  assert.equal(holdouts.filter(other => other.name === row.name).length, 2);
}
const overlaps = json('cohorts/overlap.json');
for (const profile of Object.values(overlaps)) for (const field of Object.values(profile.matches)) {
  assert.equal(field.pairs, field.matches.length);
  assert.equal(field.leftCases, new Set(field.matches.map(pair => pair.left)).size);
  assert.equal(field.rightCases, new Set(field.matches.map(pair => pair.right)).size);
}
assert.equal(overlaps.breadth68VersusProposed24.matches.declaredTarget.pairs, 24);
assert.equal(overlaps.old224VersusBreadth68.capturedHistoricalInventoryLinks.length, 3);
assert.equal(manifest.universalUnionDenominator, null);
const inventory = json('provenance/INVENTORY.json');
assert.equal(inventory.totalHashBytes, 488156494);
assert.equal(inventory.summary.nativeRecordsVerified, 137);
assert.equal(inventory.summary.nativeRecordsBlocked, 1);
assert.equal(inventory.unresolvedHistoricalNativeNames.length, 12);
for (const label of ['authenticated-extraction', 'old-replay-installed-package', 'authenticated-execution-package', 'live-installed-comparator-not-candidate']) {
  const tree = inventory.trees.find(item => item.label === label);
  assert.equal(tree.files.length, 955);
  assert.equal(tree.status, 'VERIFIED_BYTES_AND_MEMBERSHIP');
}
assert.equal(inventory.trees.find(item => item.label === 'authenticated-execution-closure').status, 'BLOCKED_PREREQUISITE');
assert.equal(inventory.trees.find(item => item.label === 'v3-closure-with-declared-observers').files.length, 3844);
console.log(JSON.stringify({ status: 'PASS_BOUNDED_STATIC_AUDIT', caps, totalBytes, gitBlobReads: 7, groups, historicalScoresOnly: scores, breadth: { primary: 61, diagnostics: 7, targets: 54, outcomes: 136, normalChildren: 135 }, holdouts: { proposed: 24, names: 12, nativeOracles: 0 }, metadataGap: { declaredSharedControlIds: manifest.breadth.sharedControlIds, omittedSharedOptionalControl: 'curl-positive' }, provenanceBoundary: 'Existing receipts checked, not package/dependency/native bytes reauthenticated', engineImports: 0, engineCalls: 0, nativeWorkloads: 0, timingTrials: 0, receipts }, null, 2));
