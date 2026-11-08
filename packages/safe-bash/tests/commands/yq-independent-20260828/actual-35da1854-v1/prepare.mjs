import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { authenticate, base, fileRecord, gitEntries, json, owned, repository, save, sha256, snapshot } from './auth.mjs';

const prep = join(repository, base, 'executor-preparation-v1');
const packet = join(repository, base, 'candidate-35da1854-v1');
const output = join(owned, 'preparation');
if (!existsSync(output)) mkdirSync(output);
const scopes = [
  ['bd471ef682d768692a682d40009a874f51e3ad68', `${base}/final-carry-v1`],
  ['de89e478d8ddce62eac955708f1b87d7be1bd137', `${base}/final-carry-review-v1`],
  ['71a16afd5b430175180fc4741531b75c31b25882', `${base}/candidate-35da1854-v1`],
  ['409449136ae1adc252ff6e205a6bb5785d113d0f', `${base}/executor-preparation-v1/consumers`],
  ['90c4c50070334a34c1b75d78f7da25d302f6bb61', `${base}/executor-preparation-v1/consumers-v2`],
  ['ee9d0c1fd24b33aa918154eb379a92c02cfe5925', `${base}/executor-preparation-v1/runtime/recipe`],
  ['70fa3df66f9c8dc3f972cfa8c0c5862d77d7514e', `${base}/executor-preparation-v1/runtime-v2`],
  ['83035d641c415019ac62a0d0114cf2836ba77e45', `${base}/executor-preparation-v1/integration-v2`],
  ['7ed356ade4509e492e15615587408eb4b41f92e0', `${base}/executor-review-v1/results-v2`],
  ['6af0eb2d627f3ed80255c295b79299708436d372', `${base}/executor-review-v1/results-v3`],
];
const records = [];
for (const [commit, path] of scopes) records.push(...authenticate(gitEntries(commit, path)));
const sourceBindings = json(join(prep, 'runtime/recipe/source-bindings.json'));
for (const binding of sourceBindings.bindings) {
  const [record] = authenticate(gitEntries(binding.revision, binding.path));
  assert.equal(record.sha256, binding.sha256);
  records.push(record);
}
for (const binding of json(join(prep, 'runtime-v2/BINDINGS.json')).entries) {
  const [record] = authenticate(gitEntries(binding.commit, binding.path), binding.liveImmutable);
  assert.equal(record.sha256, binding.sha256);
  records.push(record);
}
const pins = json(join(prep, 'integration-v2/core/COMPONENTS.json'));
for (const binding of [pins.author.handoff, pins.author.manifest]) {
  const [record] = authenticate(gitEntries(binding.revision, binding.path));
  assert.equal(record.sha256, binding.sha256);
  records.push(record);
}
const seals = [
  [join(prep, 'integration-v2/SEAL-v4.json'), '47c3874f520efee18062d4b2e687159a52039a86d35945a7f5371e85eb00fdff'],
  [join(prep, 'runtime-v2/RECIPE-SEAL.json'), 'fc273904cf20f4a717bb7350bb46046bbee16617aee371bcfd03e38d98920f15'],
  [join(prep, 'consumers-v2/RECIPE-SEAL.json'), '69dfaf2aa833590312d80515a62d1dcc544952e55f9844aea73a3a8c2d90330b'],
  [join(repository, base, 'executor-review-v1/results-v3/VERDICT.json'), 'cf413356d14da03527e11fe44a9998f2d1105e1dd957928a790a947deffd6e82'],
  [join(packet, 'FINAL-SEAL.json'), '979cacf27eae6d3fc46980d35df17f8135274a4441f1d08d1f2768907b4cced3'],
];
for (const [path, expected] of seals) assert.equal(fileRecord(path).sha256, expected, path);
const maps = json(join(packet, 'MAPS.json'));
const receipt = json(join(packet, 'FULL-RECEIPT.json'));
const selected = json(join(prep, 'consumers/SELECTED.json'));
assert.equal(process.execPath, selected.tools.node.path);
assert.equal(process.version, selected.tools.node.version);
assert.equal(fileRecord(process.execPath).sha256, selected.tools.node.sha256);
const sourceRecords = [];
for (const selection of maps.gitSelections.filter((entry) => Object.hasOwn(maps.archive.files, entry.path))) {
  const expectedRevision = Object.hasOwn(receipt.sourceAdditions, selection.path) ? pins.author.sourceCommit : selection.path === 'src/commands/structured/interpreter.ts' ? pins.acceptedLength : pins.baseline;
  assert.equal(selection.revision, expectedRevision, selection.path);
  const [record] = authenticate(gitEntries(selection.revision, selection.path), false);
  assert.equal(record.blob, selection.blob);
  assert.deepEqual({ sha256: record.sha256, bytes: record.bytes, mode: record.mode }, maps.archive.files[selection.path]);
  sourceRecords.push(record);
}
assert.equal(sourceRecords.length, 273);
const material = json(join(packet, 'MATERIALIZATION.json'));
const runtimeSource = join(prep, 'integration-v2/validation-UdOTznoL/run-2026-08-28T09-41-48.478Z-07f64989-c68e-4012-9170-50cca3afcdcd/runtime-recipe');
const runtimeSeal = json(seals[1][0]);
assert.deepEqual(snapshot(runtimeSource), runtimeSeal.entries);
const existingRoot = existsSync(join(owned, 'ROOT-EXECUTION.json')) ? json(join(owned, 'ROOT-EXECUTION.json')) : null;
const temporary = existingRoot ? dirname(existingRoot.runtimeRecipeRoot) : mkdtempSync('/private/tmp/yq-actual-independent-35da1854-');
const runtimeRoot = join(temporary, 'runtime-recipe');
const evidenceParent = join(temporary, 'evidence');
if (!existingRoot) {
  mkdirSync(runtimeRoot, { mode: 0o755 });
  mkdirSync(evidenceParent, { mode: 0o755 });
  for (const entry of runtimeSeal.entries.filter((entry) => entry.kind === 'file')) {
    copyFileSync(join(runtimeSource, entry.path), join(runtimeRoot, entry.path));
    chmodSync(join(runtimeRoot, entry.path), entry.mode);
  }
}
assert.deepEqual(snapshot(runtimeRoot), runtimeSeal.entries);
const physical = [
  [material.archive.root, maps.archive],
  [material.source.original, maps.source], [material.source.moved, maps.source],
  [material.package.original, maps.fullPackage], [material.package.moved, maps.fullPackage],
];
for (const [path, expected] of physical) {
  const entries = snapshot(path);
  const files = Object.fromEntries(entries.filter((entry) => entry.kind === 'file').map(({ path: name, kind, ...record }) => [name, record]));
  const directories = Object.fromEntries(entries.filter((entry) => entry.kind === 'directory').map((entry) => [entry.path === '.' ? '' : entry.path, entry.mode]));
  assert.deepEqual(files, expected.files, path);
  assert.deepEqual(directories, expected.directories, path);
}
const sourceArchive = { path: join(material.artifacts.root, 'SOURCE.tar'), sha256: pins.author.archiveSha256 };
const packageArchive = { path: join(material.artifacts.root, 'virtual-bash-0.0.0.tgz'), sha256: pins.author.packageSha256 };
for (const entry of [sourceArchive, packageArchive]) assert.equal(fileRecord(entry.path).sha256, entry.sha256);
const root = {
  schema: 1, purpose: 'YQ_COMPOUND_V2_AFTER_ROOT_PRESEAL', execute: true,
  rootApproval: '2026-08-28 explicit user/root routing: ONE bounded DIFFERENT actual review, original194+8 overlays, exact frozen integration once; acd5644c full receipt trusted only AUTHOR_ARTIFACT_BINDING_ONLY; no duplicate review, no public acceptance.',
  integrationSealSha256: seals[0][1], authorSourceCommit: pins.author.sourceCommit,
  consumerCandidateCommit: pins.author.sourceCommit, sourceBase: pins.baseline, acceptedLength: pins.acceptedLength,
  rootSourceCompositionAccepted: true,
  consumerReceipt: { path: join(repository, pins.packet.fullReceipt.path), sha256: pins.packet.fullReceipt.sha256 },
  admissionReceipt: { path: join(repository, pins.packet.admissionReceipt.path), sha256: pins.packet.admissionReceipt.sha256 },
  frameworkReviewReceipt: { path: seals[3][0], sha256: seals[3][1] },
  sourceArchive, packageArchive, archiveSourceRoot: material.archive.root,
  consumerSourceRoot: material.source.original, packageRoot: material.package.original,
  runtimeRecipeRoot: runtimeRoot, outputParent: evidenceParent,
  buildProof: { classification: 'AUTHOR_ARTIFACT_BINDING_ONLY', receipt: null },
};
if (existingRoot) assert.deepEqual(root, existingRoot);
else save(join(owned, 'ROOT-EXECUTION.json'), root);
const treeRoots = new Set([
  ...scopes.map(([, path]) => join(repository, path)), ...sourceBindings.scopes.map((scope) => join(repository, scope.path)),
  ...physical.map(([path]) => path), material.artifacts.root, runtimeRoot,
  ...['typescript', 'nodeTypes', 'undiciTypes'].map((name) => join(repository, selected.tools[name].path)),
]);
const guards = [...treeRoots].map((path) => {
  const historicalData = scopes.some(([, scope]) => path === join(repository, scope));
  const entries = snapshot(path, historicalData);
  return { kind: 'tree', path, historicalData, digest: sha256(JSON.stringify(entries)), entries };
});
for (const path of [process.execPath, join(owned, 'ROOT-EXECUTION.json'), ...sourceBindings.bindings.map((entry) => join(repository, entry.path)), ...[pins.author.handoff, pins.author.manifest].map((entry) => join(repository, entry.path))]) {
  const record = fileRecord(path);
  guards.push({ kind: 'file', path, digest: sha256(JSON.stringify(record)), record });
}
for (const name of ['typescript', 'nodeTypes', 'undiciTypes']) {
  const path = join(repository, selected.tools[name].path);
  const rows = snapshot(path).filter((entry) => entry.path !== '.').map((entry) => entry.kind === 'directory' ? [entry.path, 'directory', entry.mode] : [entry.path, entry.sha256, entry.bytes, entry.mode]);
  assert.equal(sha256(JSON.stringify(rows)), selected.tools[name].sha256, name);
  assert.equal(rows.length, selected.tools[name].entries, name);
}
const inventory = json(join(prep, 'runtime/recipe/inventory.json'));
save(join(output, 'AUTHENTICATION.json'), { date: '2026-08-28', records, sourceRecords, seals, tools: selected.tools, productImports: 0, independentCompile: false, historicalReceiptsUnmodified: true });
save(join(output, 'INPUT-GUARDS.json'), guards);
save(join(output, 'INVENTORY-194.json'), inventory);
save(join(output, 'SOURCE-STATIC-PLAN.json'), {
  role: 'SOURCE_STATIC_PARTIAL_NOT_RUNTIME_PROOF', ids: inventory.rows.filter((row) => row.primaryRole === 'source-static-counterproof'),
  files: sourceRecords.filter((entry) => entry.path.startsWith('src/commands/yq/') || /^src\/commands\/structured\/(query-core|interpreter|limits|parser|numbers|values)\.ts$/u.test(entry.path)),
  criticalOverlays: ['ENC-07', 'WRK-22', 'WRK-26'],
  predicates: ['Inspect designated frozen record obligations against exact selected source; report line and blob evidence.', 'CARRY selection preserves invocation-total work; invalid counter misuse escapes; no local resets.', 'Alias validity, depth/value/node/work/count projections precede copy; no runtime private-hook claim.', 'Signal/close, read-only input and output reservations preserve explicit ordering; static evidence cannot replace dynamic boundary observation.'],
  noProductImports: true, noNewRuntimeProbes: true, noSemanticPasses: true,
});
save(join(output, 'PREPARATION.json'), { temporary, runtimeRoot, evidenceParent, rootHash: fileRecord(join(owned, 'ROOT-EXECUTION.json')).sha256, guardCount: guards.length, sourceRecords: sourceRecords.length, authenticatedRecords: records.length, buildHandoffPresent: existsSync('/tmp/yq-build-independent-ready.txt'), productImports: 0, children: 0 });
console.log(JSON.stringify({ status: 'PREPARED_DATA_ONLY', temporary, guards: guards.length, authenticatedRecords: records.length, productImports: 0 }));
