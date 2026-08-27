import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, readlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const directory = dirname(fileURLToPath(import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (relative) => JSON.parse(await readFile(join(directory, relative), 'utf8'));
const seal = await json('PRESEAL-MANIFEST.json');
const results = await json('evidence/initial/initial-results.json');
const analysis = await json('evidence/initial/analysis.json');

test('original private corpus and all 97 sealed artifacts remain byte-identical', async () => {
  assert.equal(seal.payloadSha256, 'b9863722f41cbdd56119ab95c3446ca3b65a5b752ccafc28dc6f9044854d2937');
  const bytes = await readFile(join(directory, 'sealed/inventory.json'));
  assert.equal(hash(bytes), seal.privateInventorySha256);
  const inventory = JSON.parse(bytes);
  assert.equal(hash(JSON.stringify(inventory)), seal.payloadSha256);
  assert.equal(inventory.length, 97);
  for (const item of inventory) {
    const destination = join(directory, 'sealed', item.path);
    assert.equal((await lstat(destination)).isSymbolicLink(), item.kind === 'symlink', item.path);
    const contents = item.kind === 'symlink' ? Buffer.from(await readlink(destination)) : await readFile(destination);
    assert.equal(hash(contents), item.sha256, item.path);
  }
  assert.equal(hash(await readFile(join(directory, 'evidence/initial/original-prep-detail.txt'))), seal.prepDetailSha256);
});
test('initial 38-case source cohort retains every raw status and attempt', () => {
  assert.equal(results.cohort.length, 38);
  assert.equal(new Set(results.cohort.map((row) => row.id)).size, 38);
  assert.deepEqual(results.totals, { pass: 30, 'unsupported-not-pass': 3, fail: 2, 'characterized-not-pass': 3 });
  assert.equal(results.productInvocations, 35);
  assert.ok(results.elapsedMs < results.globalDeadlineMs);
  for (const row of results.cohort) { assert.equal(row.killedFor, undefined); assert.equal(row.completion.signal, null); }
});
test('raw native mismatch lane is not silently replaced by semantic passes', () => {
  assert.deepEqual(analysis.rawNativeLaneCounts, { match: 12, 'unsupported-not-run': 3, 'mismatch-not-parity-pass': 5 });
  assert.deepEqual(analysis.nativeLanes.filter((row) => row.rawExact === 'mismatch-not-parity-pass').map((row) => row.id), ['N14', 'N16', 'N17', 'N18', 'N20']);
  assert.equal(analysis.nativeLanes.find((row) => row.id === 'N20').jsonSemantic, 'equal');
  assert.equal(analysis.nativeLanes.find((row) => row.id === 'N18').sealedPredicateStatus, 'fail');
});
test('pre-execution binding/profile hashes and all frozen input manifests survive', async () => {
  const provenance = await json('evidence/initial/provenance-check.json');
  const freeze = await json('evidence/initial/freeze.json');
  assert.equal(hash(await readFile(join(directory, 'driver/bridge.mjs'))), provenance.preExecutionBridgeSha256);
  assert.equal(hash(await readFile(join(directory, 'evidence/initial/profile.json'))), provenance.preExecutionProfileSha256);
  assert.equal(hash(await readFile(join(directory, 'evidence/initial/full-input-files.json'))), freeze.fullInputManifestSha256);
  assert.equal(analysis.allFrozenInputFilesChecked, 14205);
  assert.deepEqual(analysis.inputDrift, []);
  assert.deepEqual(analysis.unexpectedLoadedPaths, []);
});
test('actual Shell pipeline and direct abort observations remain distinct evidence', () => {
  assert.equal(analysis.shellEvidence.length, 1);
  assert.equal(analysis.shellEvidence[0].className, 'Shell');
  assert.equal(analysis.shellEvidence[0].disposed, true);
  assert.equal(analysis.shellEvidence[0].exitCode, 0);
  for (const evidence of analysis.cancellationEvidence) assert.equal(evidence.sameAsSignalReason, true);
  assert.equal(analysis.adjudicated.demonstratedSourceBugs, 0);
  assert.equal(analysis.adjudicated.outsideCoreFailures, 0);
});
