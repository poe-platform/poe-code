import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, readlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const directory = dirname(fileURLToPath(import.meta.url));
const base = join(directory, '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async filename => JSON.parse(await readFile(join(directory, filename), 'utf8'));

test('durable final artifact manifest verifies exact bytes and symlink targets', async () => {
  const manifest = await json('FINAL-MANIFEST.json');
  assert.equal(hash(JSON.stringify(manifest.files)), manifest.payloadSha256);
  for (const entry of manifest.files) {
    const filename = join(directory, entry.path);
    const info = await lstat(filename);
    assert.equal(info.isSymbolicLink(), entry.kind === 'symlink');
    const bytes = info.isSymbolicLink() ? Buffer.from(await readlink(filename)) : await readFile(filename);
    assert.equal(bytes.length, entry.bytes, entry.path);
    assert.equal(hash(bytes), entry.sha256, entry.path);
  }
});
test('fresh38 is distinct from initial38 and preserves all nonpass classes', async () => {
  const report = await json('initial-results.json');
  assert.equal(report.cohort.length, 38);
  assert.equal(new Set(report.cohort.map(row => row.id)).size, 38);
  assert.deepEqual(report.totals, { pass: 31, 'unsupported-not-pass': 3, fail: 1, 'characterized-not-pass': 3 });
  assert.equal(report.productInvocations, 35);
  assert.deepEqual(report.cohort.filter(row => row.status === 'fail').map(row => row.id), ['N16']);
  for (const row of report.cohort) {
    assert.equal(row.killedFor, undefined);
    assert.equal(row.completion.signal, null);
    assert.ok(row.observationAvailable);
  }
  const analysis = await json('analysis.json');
  assert.equal(analysis.execution.reusedSelectionResults, 0);
  assert.equal(analysis.execution.totalFreshTreeInvocations, 36);
  assert.equal(analysis.execution.retries, 0);
});
test('native exact lane stays 12/5/3 with original captures unchanged', async () => {
  const analysis = await json('analysis.json');
  assert.deepEqual(analysis.rawNativeLaneCounts, { match: 12, 'unsupported-not-run': 3, 'mismatch-not-parity-pass': 5 });
  assert.deepEqual(analysis.nativeLanes.filter(row => row.rawExact === 'mismatch-not-parity-pass').map(row => row.id), ['N14', 'N16', 'N17', 'N18', 'N20']);
  assert.equal(hash(await readFile(join(directory, 'harness/derived/native.json'))), '5b89a6577600326878987f4d985270087d26fa7d3abd00f5c98fab973619c897');
  assert.equal(analysis.execution.nativeInvocations, 0);
  assert.equal(analysis.nativeLanes.find(row => row.id === 'N18').output.exitCode, 2);
  assert.equal(analysis.nativeLanes.find(row => row.id === 'N18').native.exitCode, 1);
});
test('completed peer GO binds v2 while original runner/corpus remain preserved', async () => {
  const gate = await json('execution-gate.json');
  const peer = await readFile(join(directory, 'completed-peer-report.original.txt'));
  assert.equal(hash(peer), gate.completedPeerReportSha256);
  assert.match(peer.toString(), /Tree N18 v2 predicate: GO, finite whole-single-diagnostic profile only\./u);
  assert.equal(hash(await readFile(join(directory, 'harness/n18-predicate.mjs'))), 'c38705fdc2afbecfd3dda00b4867bd6eae82074206001eadbc927e516f22171c');
  assert.equal(hash(await readFile(join(directory, 'harness/derived/run.mjs'))), '1fd45d8397f19122139c86c2d3321436346c90997448f997073029ef42ac11dd');
  assert.equal(hash(await readFile(join(base, 'sealed/run.mjs'))), '3068e51fece206bdcab38a53f5fb47b61cdfc5a71f35900f7241bf9f291fc03d');
  assert.equal(hash(await readFile(join(directory, 'harness/derived/corpus.mjs'))), '1dc3e241eaf3708facb9062abf219c7a7e6c01d348ebd7cb1516aaff3d0ae8a4');
  for (const [path, expected] of [['EVIDENCE-MANIFEST.json', '66ecd953ee0959f249387b3eab9f7d9f20afa32eca36bb123a82810187997b01'],
    ['corrections/n18-positive-depth/CORRECTION-MANIFEST.json', '18cb04609766ba7ee13a8f2d6a5d41094ebe58e63cdffb298f61f12c81c9d5d6'],
    ['corrections/n18-positive-depth-v2/V2-MANIFEST.json', '211a071d5e78a66791b37790804bbe6fa5cb737fafc052c00529a8d4d282602d']]) {
    assert.equal(hash(await readFile(join(base, path))), expected);
  }
});
test('frozen closure and successful compiler inventories contain no live alias', async () => {
  const freeze = await json('freeze.json');
  assert.equal(freeze.commit, '436bda3e21b2b6041409fac7408cf072b5d3fe5e');
  assert.equal(hash(await readFile(join(directory, 'full-input-files.json'))), freeze.fullInputManifestSha256);
  const analysis = await json('analysis.json');
  assert.equal(analysis.allFrozenInputFilesChecked, 15617);
  assert.deepEqual(analysis.inputDrift, []);
  assert.deepEqual(analysis.sourceClosure.unexpectedLoadedPaths, []);
  assert.equal(analysis.sourceClosure.loadedSourceCount, 31);
  assert.equal(analysis.sourceClosure.loadedDevtoolCount, 22);
  const compiler = await json('compiler-input-closure.json');
  assert.equal(compiler.canonicalOwnedTsCount, 15);
  assert.deepEqual(compiler.missingCanonical, []);
  assert.equal((await json('consumer-result.json')).productInvocations, 1);
});
test('actual Shell, cancellation, cleanup and preservation remain recorded', async () => {
  const analysis = await json('analysis.json');
  assert.equal(analysis.shellEvidence.length, 1);
  assert.equal(analysis.shellEvidence[0].className, 'Shell');
  assert.equal(analysis.shellEvidence[0].disposed, true);
  assert.equal(analysis.shellEvidence[0].exitCode, 0);
  for (const entry of analysis.cancellationEvidence) assert.equal(entry.sameAsSignalReason, true);
  assert.deepEqual(analysis.processState.liveAtCheck, []);
  const preservation = await json('preservation-after.json');
  assert.deepEqual(preservation.drift, []);
  assert.equal(preservation.originalArtifacts, 316);
  assert.equal(preservation.v1Artifacts, 35);
  assert.equal(preservation.v2Artifacts, 37);
  assert.equal(preservation.privateArtifacts, 97);
});
