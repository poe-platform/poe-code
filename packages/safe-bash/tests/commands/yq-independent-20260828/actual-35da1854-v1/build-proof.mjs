import assert from 'node:assert/strict';
import { join } from 'node:path';
import { authenticate, base, fileRecord, gitEntries, json, owned, repository, save, snapshot } from './auth.mjs';

const commit = 'f7503dc7dce11f9a3072b3670df498d64305d737';
const scope = `${base}/candidate-35da1854-build-v1`;
const root = join(repository, scope);
const records = authenticate(gitEntries(commit, scope));
assert.equal(fileRecord(join(root, 'FINAL-SEAL.json')).sha256, 'c8c6b98809ddb909c4b93f6e057d67cfd566bbfbeafd7088b2b0eeb4ebafcdb6');
const seal = json(join(root, 'FINAL-SEAL.json'));
for (const [path, expected] of Object.entries(seal.files)) assert.deepEqual(fileRecord(join(root, path)), expected);
const receipt = json(join(root, 'INDEPENDENT-BUILD-RECEIPT.json'));
assert.equal(fileRecord(join(root, 'INDEPENDENT-BUILD-RECEIPT.json')).sha256, 'ae74c3f95061d481aec2dab99260214eb22babf5b1d2682b37928a9cc8dd62d6');
const maps = json(join(repository, base, 'candidate-35da1854-v1/MAPS.json'));
assert.equal(receipt.sourceMapSha256, maps.sourceMapSha256);
assert.equal(receipt.packageMapSha256, maps.packageMapSha256);
assert.equal(receipt.candidateCommit, '35da18547ca82a67be9ca22b4adc21e3b8060780');
const independent = json(receipt.independentPackageMap.path);
assert.deepEqual(independent, { files: maps.fullPackage.files, directories: maps.fullPackage.directories });
const compiler = json(receipt.compilerProcess.path);
assert.equal(compiler.exitCode, 0);
assert.equal(compiler.signal, null);
assert.equal(compiler.spawnError, null);
assert(!compiler.timedOut && !compiler.overflow && compiler.reaped && compiler.groupAbsent);
assert.equal(fileRecord(receipt.artifact.path).sha256, '2942ba1f6982a2e217350bbbad420e93d43e9336324b6db8a3d1d88b5a7aee4d');
assert.equal(fileRecord(receipt.command.executable).sha256, '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011');
const sourceEntries = snapshot(receipt.command.cwd);
assert.deepEqual(Object.fromEntries(sourceEntries.filter((entry) => entry.kind === 'file').map(({ path, kind, ...file }) => [path, file])), maps.source.files);
const raw = json(receipt.rawOutputMap.path);
assert.deepEqual(Object.fromEntries(snapshot(compiler.rawOutputRoot).filter((entry) => entry.kind === 'file').map(({ path, kind, ...file }) => [path, file])), raw.files);
const comparisons = json(receipt.comparisons.path);
assert.deepEqual(comparisons.mismatches, []);
assert.equal(receipt.rawEqualOutputs, 434);
assert.equal(receipt.explicitlyRelocatedMaps, 434);
assert.equal(receipt.finalEqualOutputs, 868);
assert.equal(receipt.fullPackageFiles, 870);
const beforeAfter = snapshot(root);
save(join(owned, 'execution/BUILD-PROOF-AUTHENTICATED.json'), {
  date: '2026-08-28', receivedAfterActualPreseal: true, commit, presealCommit: seal.presealCommit,
  receiptSha256: fileRecord(join(root, 'INDEPENDENT-BUILD-RECEIPT.json')).sha256, records,
  scopeSnapshot: beforeAfter, compilerProcess: compiler, receipt,
  findings: 'Committed independent compile evidence has zero-exit/reap; selected271 source, raw868 emitted files and exact final870 package map/hash authenticated. JS/declarations434 raw equal; maps434 equality requires explicitly disclosed relocation. No build rerun by this reviewer.',
  separateAdditiveProof: true, frozenExecutionEnvelopeChanged: false,
  executionClassification: 'AUTHOR_ARTIFACT_BINDING_ONLY', publicIntegration: false,
  compilerRunsByThisReviewer: 0, semanticPassesAdded: 0,
});
console.log(JSON.stringify({ status: 'SEPARATE_COMPILE_PROOF_AUTHENTICATED', files: records.length, compileRunsByReviewer: 0, envelopeUnchanged: true }));
