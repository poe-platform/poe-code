import assert from 'node:assert/strict';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { coreRoot, framework, hash, loadComponents, readBound, readJson, repository, verifyIntegration } from './components.mjs';
import { assertFullPackage, directoryMap, runtimeEntries, validateEnvelope } from './translation.mjs';

const omittedTestData = [
  'tests/commands/structured-stress/harness.ts', 'tests/commands/structured-stress/join-safety.test.ts',
  'tests/commands/yq-author-20260828/PROTOCOL.md', 'tests/commands/yq-author-20260828/tsconfig.json',
  'tests/commands/yq-author-20260828/vectors.json', 'tests/commands/yq-author-20260828/yq.test.ts',
];

export async function bind(rootPath, rootHash, sealPath, sealHash) {
  assert(rootPath && rootHash && sealPath && sealHash, 'Missing explicit root binding; no child/import/output admitted');
  const seal = verifyIntegration(sealPath, sealHash);
  const root = JSON.parse(readBound(rootPath, rootHash));
  const pins = readJson(join(coreRoot, 'COMPONENTS.json'));
  validateEnvelope(root, sealHash, pins);
  const components = await loadComponents();
  const { guards, runtime, recipe } = components;
  const receipt = guards.readHashedJson(root.consumerReceipt.path, root.consumerReceipt.sha256);
  guards.validateReceiptShape(receipt);
  assert.equal(receipt.sourceBase, pins.baseline);
  assert.equal(receipt.acceptedLength, pins.acceptedLength);
  assert.equal(receipt.candidateCommit, root.consumerCandidateCommit);
  const sourceBase = readJson(join(framework, 'consumers/SOURCE-BASE.json'));
  const baselinePackage = readJson(join(framework, 'consumers/BASELINE-PACKAGE.json'));
  const selected = readJson(join(framework, 'consumers/SELECTED.json'));
  const authorManifest = JSON.parse(readBound(join(repository, pins.author.manifest.path), pins.author.manifest.sha256));
  assert.equal(authorManifest.sourceCommit, pins.author.sourceCommit);
  assert(authorManifest.files.every((file) => file.mode === '100644'), 'Author manifest regular-file modes');
  assert.deepEqual(authorManifest.files.filter((file) => file.path.startsWith('tests/')).map((file) => file.path), omittedTestData);
  const descriptor = (file) => ({ sha256: file.sha256, bytes: file.bytes, mode: 420 });
  const additions = Object.fromEntries(authorManifest.files.filter((file) => file.path.startsWith('src/commands/yq/') || file.path === 'src/commands/structured/query-core.ts').map((file) => [file.path, descriptor(file)]));
  assert.equal(Object.keys(additions).length, 7);
  assert.deepEqual(receipt.sourceAdditions, additions, 'Exactly seven author-bound additions');
  const sourceFiles = Object.fromEntries(Object.entries(sourceBase).map(([path, file]) => [path, descriptor(file)]));
  Object.assign(sourceFiles, additions);
  const archiveFiles = Object.fromEntries(authorManifest.files.filter((file) => !omittedTestData.includes(file.path)).map((file) => [file.path, descriptor(file)]));
  assert.equal(Object.keys(sourceFiles).length, 271);
  assert.equal(Object.keys(archiveFiles).length, 273);
  assert.deepEqual(Object.keys(archiveFiles).filter((path) => !Object.hasOwn(sourceFiles, path)).sort(), ['package-lock.json', 'scripts/typecheck.mjs']);
  for (const [path, value] of Object.entries(sourceFiles)) assert.deepEqual(archiveFiles[path], value, 'Archive/consumer source projection mismatch');
  const sourceTree = { files: sourceFiles, directories: directoryMap(sourceFiles) };
  const archiveTree = { files: archiveFiles, directories: directoryMap(archiveFiles) };
  const packageTree = guards.expectedPackage(receipt, baselinePackage, selected.readme);
  assertFullPackage(packageTree.files, selected.readme);
  assert.equal(receipt.entries.yq, 'dist/commands/yq/index.js');
  assert.equal(packageTree.files[receipt.entries.yq].sha256, pins.author.entrySha256);
  const builtins = new Set(['node:path', 'node:util', 'node:buffer', 'node:stream', 'node:stream/web']);
  assert(receipt.allowedBuiltins.every((name) => builtins.has(name)), 'RUNTIME_BUILTIN_SCOPE_GAP: sealed runtime fence cannot widen');
  const build = guards.readHashedJson(receipt.buildReceipt.path, receipt.buildReceipt.sha256);
  assert.equal(build.candidateCommit, root.consumerCandidateCommit);
  assert.equal(build.sourceMapSha256, guards.sha256(guards.canonical(sourceFiles)));
  assert.equal(build.packageMapSha256, guards.sha256(guards.canonical(packageTree)));
  const inputs = [root.consumerReceipt, root.admissionReceipt, root.frameworkReviewReceipt, root.sourceArchive, root.packageArchive, receipt.buildReceipt];
  if (root.buildProof.receipt) inputs.push(root.buildProof.receipt);
  for (const input of inputs) readBound(input.path, input.sha256);
  assert.equal(process.execPath, selected.tools.node.path);
  assert.equal(process.version, selected.tools.node.version);
  readBound(process.execPath, selected.tools.node.sha256);
  for (const [path, tree] of [[root.archiveSourceRoot, archiveTree], [root.consumerSourceRoot, sourceTree], [root.packageRoot, packageTree]]) {
    assert(!guards.within(repository, path), 'Future materialized candidate must be outside the workspace');
    guards.assertPackageTree(path, tree);
  }
  const roots = [root.archiveSourceRoot, root.consumerSourceRoot, root.packageRoot, coreRoot, join(framework, 'consumers'), components.runtimeRoot];
  guards.regularRoot(root.outputParent);
  assert(!guards.within(repository, root.outputParent), 'Future consumer output must be outside the workspace');
  for (const left of roots) {
    assert(!guards.within(left, root.outputParent) && !guards.within(root.outputParent, left), 'Output/input scope overlap');
    for (const right of roots) if (left !== right) assert(!guards.within(left, right), 'Candidate/component roots overlap');
  }
  const guardList = [
    { kind: 'tree', path: coreRoot, sha256: seal.coreTreeSha256 },
    { kind: 'tree', path: join(framework, 'consumers'), sha256: runtime.integrity.jsonHash(runtime.integrity.treeSnapshot(join(framework, 'consumers'))) },
    { kind: 'tree', path: components.runtimeRoot, sha256: pins.runtime.treeSha256 },
    ...[[root.archiveSourceRoot, archiveTree], [root.consumerSourceRoot, sourceTree], [root.packageRoot, packageTree]].map(([path, tree]) => ({ kind: 'tree', path, sha256: runtime.integrity.jsonHash(runtimeEntries(tree)) })),
    ...[...inputs, { path: rootPath, sha256: rootHash }, { path: sealPath, sha256: sealHash }, { path: process.execPath, sha256: selected.tools.node.sha256 }].map((file) => ({ kind: 'file', ...file, mode: lstatSync(file.path).mode & 4095, maximumBytes: 134217728 })),
  ];
  runtime.integrity.verifyGuards(guardList);
  return { ...components, root, rootPath, rootHash, sealPath, sealHash, receipt, selected, sourceTree, archiveTree, packageTree, guardList, sourceMapSha256: build.sourceMapSha256, packageMapSha256: build.packageMapSha256, node: { path: process.execPath, sha256: selected.tools.node.sha256, mode: lstatSync(process.execPath).mode & 4095 }, hash };
}

export function admitSource(bound, explicitSourcePass = false) {
  const { root, guards } = bound;
  if (explicitSourcePass) {
    const authority = guards.authorizeSources(root.consumerReceipt.path, root.consumerReceipt.sha256);
    guards.assertSourceMaterialization(authority, root.consumerSourceRoot);
  }
  const candidate = guards.authorizeCandidate(root.consumerReceipt.path, root.consumerReceipt.sha256, root.packageRoot);
  guards.assertSourceMaterialization(candidate, root.consumerSourceRoot);
  assert.equal(candidate.sourceMapSha256, bound.sourceMapSha256);
  return candidate;
}
