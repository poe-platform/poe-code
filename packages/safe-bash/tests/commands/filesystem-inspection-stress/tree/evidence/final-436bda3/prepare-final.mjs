import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, cp, lstat, mkdir, readFile, readlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const base = '/Users/kjopek/Workspace/safe-bash/tests/commands/filesystem-inspection-stress/tree';
const privateRoot = '/tmp/safe-bash-tree-hidden-prep-vyzfHc';
const v1 = join(base, 'corrections/n18-positive-depth');
const v2 = join(base, 'corrections/n18-positive-depth-v2');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async filename => JSON.parse(await readFile(filename, 'utf8'));
const publish = async (filename, value) => writeFile(join(directory, filename), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
async function verify(root, entries) {
  for (const entry of entries) {
    const filename = join(root, entry.path);
    const info = await lstat(filename);
    if (entry.kind) assert.equal(info.isSymbolicLink(), entry.kind === 'symlink', filename);
    const bytes = info.isSymbolicLink() ? Buffer.from(await readlink(filename)) : await readFile(filename);
    assert.equal(hash(bytes), entry.sha256, filename);
    if (entry.bytes !== undefined) assert.equal(bytes.length, entry.bytes, filename);
  }
}
const original = await readFile(join(base, 'EVIDENCE-MANIFEST.json'));
assert.equal(hash(original), '66ecd953ee0959f249387b3eab9f7d9f20afa32eca36bb123a82810187997b01');
await verify(base, JSON.parse(original).entries);
const originalV1 = await readFile(join(v1, 'CORRECTION-MANIFEST.json'));
assert.equal(hash(originalV1), '18cb04609766ba7ee13a8f2d6a5d41094ebe58e63cdffb298f61f12c81c9d5d6');
await verify(v1, JSON.parse(originalV1).files);
const originalV2 = await readFile(join(v2, 'V2-MANIFEST.json'));
const manifestV2 = JSON.parse(originalV2);
assert.equal(manifestV2.payloadSha256, 'c56715e3f8e99c5c39b2d0a7f9e23f30cdaced7a54b385eb47b946870dd3e552');
assert.equal(hash(JSON.stringify(manifestV2.files)), manifestV2.payloadSha256);
await verify(v2, manifestV2.files);
const seal = await readJson(join(base, 'PRESEAL-MANIFEST.json'));
const inventory = await readFile(join(privateRoot, 'inventory.json'));
assert.equal(hash(inventory), seal.privateInventorySha256);
assert.equal(hash(JSON.stringify(JSON.parse(inventory))), 'b9863722f41cbdd56119ab95c3446ca3b65a5b752ccafc28dc6f9044854d2937');
await verify(privateRoot, JSON.parse(inventory));
const preservation = { at: new Date().toISOString(), originalArtifacts: JSON.parse(original).entries.length, v1Artifacts: JSON.parse(originalV1).files.length,
  v2Artifacts: manifestV2.files.length, privateArtifacts: JSON.parse(inventory).length, originalPreseal: seal.payloadSha256,
  originalManifestSha256: hash(original), v1ManifestSha256: hash(originalV1), v2ManifestSha256: hash(originalV2), drift: [] };
if (process.argv.includes('--preservation-only')) {
  await publish('preservation-after.json', preservation);
  console.log(JSON.stringify(preservation));
} else {
  await publish('preservation-before.json', preservation);
  const peerBytes = await readFile('/tmp/safe-bash-inspection-safety-prep-detail.txt');
  const peer = peerBytes.toString('utf8');
  assert.ok(peer.includes('Tree N18 v2 predicate: GO, finite whole-single-diagnostic profile only.'));
  assert.ok(peer.includes('V2 PEER RESULTS — BOTH FINISHED REPORTS INSPECTED'));
  assert.ok(peer.includes('V2 helper c38705fdc2afbecfd3dda00b4867bd6eae82074206001eadbc927e516f22171c'));
  await writeFile(join(directory, 'completed-peer-report.original.txt'), peerBytes, { flag: 'wx' });
  await mkdir(join(directory, 'harness/derived'), { recursive: true });
  for (const name of ['run.mjs', 'corpus.mjs', 'fixture-fs.mjs', 'native.json']) {
    await copyFile(join(v2, 'derived', name), join(directory, 'harness/derived', name), constants.COPYFILE_EXCL);
  }
  await copyFile(join(v2, 'n18-predicate.mjs'), join(directory, 'harness/n18-predicate.mjs'), constants.COPYFILE_EXCL);
  await cp(join(privateRoot, 'native-fixtures'), join(directory, 'harness/derived/native-fixtures'), { recursive: true, dereference: false, verbatimSymlinks: true, force: false, errorOnExist: true });
  const fixtureEntries = JSON.parse(inventory).filter(entry => entry.path.startsWith('native-fixtures/'));
  await verify(join(directory, 'harness/derived'), fixtureEntries);
  for (const name of ['bridge.mjs', 'execute.mjs']) await copyFile(join(base, 'driver', name), join(directory, name), constants.COPYFILE_EXCL);
  const frozen = await readJson(join(directory, 'freeze.json'));
  assert.equal(frozen.commit, '436bda3e21b2b6041409fac7408cf072b5d3fe5e');
  assert.equal(frozen.dependencyManifestSha256, 'e1c37e0f0c56c70dba3ce1e19bdd1678ffce01f085f59324a6ecd6a79627400e');
  const fullInputs = await readJson(join(directory, 'full-input-files.json'));
  await verify(join(directory, 'candidate'), fullInputs);
  const lock = await readJson(join(directory, 'candidate/package-lock.json'));
  const packageInfo = await readJson(join(directory, 'candidate/package.json'));
  assert.deepEqual(packageInfo.devDependencies, lock.packages[''].devDependencies);
  assert.equal(Object.keys(packageInfo.dependencies ?? {}).length, 0);
  const installed = [];
  for (const [relative, expected] of Object.entries(lock.packages)) {
    if (!relative.startsWith('node_modules/')) continue;
    let actual;
    try { actual = await readJson(join(directory, 'candidate', relative, 'package.json')); }
    catch (error) { if (error.code === 'ENOENT' && expected.optional) continue; throw error; }
    assert.equal(actual.version, expected.version, relative);
    installed.push({ path: relative, version: actual.version, integrity: expected.integrity });
  }
  await publish('dependency-lock-check.json', { packageLockSha256: hash(await readFile(join(directory, 'candidate/package-lock.json'))), installed, runtimeDependencies: 0,
    policy: 'Installed package versions match committed lock; copied bytes match historical verified dependency manifest; no download/build/install or independent tarball integrity recalculation.' });
  const originalProfile = await readFile(join(base, 'evidence/initial/profile.json'));
  await writeFile(join(directory, 'profile.original.json'), originalProfile, { flag: 'wx' });
  const profile = JSON.parse(originalProfile);
  profile.candidateSourceHash = frozen.sourceManifestSha256;
  profile.candidateCommit = frozen.commit;
  profile.authorFinishedEvidence = 'author-detail.original.txt; explicit root FinalTREEsourceHANDOFF authorization; completed-peer-report.original.txt N18 v2 GO';
  await publish('profile.json', profile);
  const gate = { at: new Date().toISOString(), decision: 'GO_N18_V2_AND_ORIGINAL_38_ONCE', completedPeerReportSha256: hash(peerBytes), candidate: frozen.commit,
    rootAuthorization: 'FinalTREEsourceHANDOFF 436bda3; original38 exactly once; no new native calls; v2 N18 only',
    helperSha256: hash(await readFile(join(directory, 'harness/n18-predicate.mjs'))), runnerSha256: hash(await readFile(join(directory, 'harness/derived/run.mjs'))),
    corpusSha256: hash(await readFile(join(directory, 'harness/derived/corpus.mjs'))), nativeSha256: hash(await readFile(join(directory, 'harness/derived/native.json'))),
    bridgeSha256: hash(await readFile(join(directory, 'bridge.mjs'))), driverSha256: hash(await readFile(join(directory, 'execute.mjs'))),
    profileSha256: hash(await readFile(join(directory, 'profile.json'))), profileMechanicalChanges: ['candidateSourceHash', 'candidateCommit', 'authorFinishedEvidence'],
    profileNote: 'Historical N18 conflict wording remains unchanged in copied profile; final v2 is authorized here, not a silent native/profile rewrite.',
    fullInputFilesVerified: fullInputs.length, nativeFixtureEntriesVerified: fixtureEntries.length, productCallsBeforeGate: 0, nativeCalls: 0 };
  assert.equal(gate.helperSha256, 'c38705fdc2afbecfd3dda00b4867bd6eae82074206001eadbc927e516f22171c');
  assert.equal(gate.runnerSha256, '1fd45d8397f19122139c86c2d3321436346c90997448f997073029ef42ac11dd');
  assert.equal(gate.corpusSha256, seal.corpusSha256);
  assert.equal(gate.nativeSha256, seal.nativeCaptureSha256);
  await publish('execution-gate.json', gate);
  console.log(JSON.stringify({ preservation, gate }, null, 2));
}
