import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const originalRoot = '/Users/kjopek/Workspace/safe-bash/tests/commands/filesystem-inspection-stress/file';
const target = join(originalRoot, 'corrections/HARN-SIGNAL-001-v2');
const sealed = '/private/tmp/safe-bash-file-holdout.KyVGrl0A';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const metadata = JSON.parse(await readFile(join(root, 'v2-correction.json')));
const verifiedHistory = [];
for (const directory of [originalRoot, join(originalRoot, 'corrections/HARN-SIGNAL-001')]) {
  const manifest = JSON.parse(await readFile(join(directory, 'PUBLICATION.json')));
  for (const entry of manifest.entries) assert.equal(hash(await readFile(join(directory, entry.path))), entry.sha256, entry.path);
  verifiedHistory.push({ root: directory, files: manifest.entries.length, publicationRoot: manifest.publicationRootSha256 });
}
const catalog = JSON.parse(await readFile(join(sealed, 'seal-catalog.json')));
for (const entry of catalog.artifacts) {
  const location = join(sealed, entry.relativePath);
  const bytes = entry.type === 'symlink-target' ? Buffer.from(await readlink(location)) : await readFile(location);
  assert.equal(hash(bytes), entry.sha256);
}
for (const entry of metadata.peerFiles) assert.equal(hash(await readFile(join(root, entry.copy))), entry.sha256);
assert.equal(hash(await readFile(join(root, 'runner/v2-runner.mjs'))), metadata.v2RunnerSha256);
const observations = JSON.parse(await readFile(join(root, 'evidence/nonproduct-observations-corrected.json')));
const cleanup = observations.observations.find((entry) => entry.id === 'cleanup-aborted-after-entry');
assert.equal(cleanup.v1.accepted, false);
assert.equal(cleanup.v2.accepted, true);
assert.equal(cleanup.v2.signalAbortedAtSettlement, true);
assert(cleanup.v2.snapshots.every((entry) => !entry.abortedAtEntry && entry.reasonUndefinedAtEntry));
for (const id of ['negative-already-aborted', 'negative-missing', 'negative-wrong-reason', 'negative-not-a-signal']) assert.equal(observations.observations.find((entry) => entry.id === id).v2.accepted, false);
const originalPeer = JSON.parse(await readFile(join(root, 'peer/F29-original-observation.json')));
assert.equal(originalPeer.observation.postCompletionAccepted, false);
const summary = {
  phase: 'HARN-SIGNAL-001-v2 PREP for peer only', preparedAt: new Date().toISOString(), peerDecisionPending: true,
  productExecutions: 0, nativeCalls: 0, full40Runs: 0, authorFixedSourceTested: false,
  nonproductChecks: { correctedRun: { pass: 6, fail: 0 }, initialPreservedDriverRun: { pass: 2, fail: 4, cause: 'Missing fileEntry dependency in extracted-callback mock driver; no runner predicate change.' } },
  observedMockRecords: observations.observations.length,
  positiveCleanupAfterEntry: { v1Rejected: true, v2Accepted: true, callerStillActive: cleanup.v2.callerStillActive, signalAbortedAtSettlement: true, snapshotsUnabortedAtEntry: true },
  negativeEntryControls: ['already-aborted', 'missing signal', 'invalid active reason', 'duck signal'],
  unchangedF33F34: true, originalHistory: { sealedArtifacts: 54, originalPublicationFiles: 285, v1PublicationFiles: 37, initialRaw40Counts: { pass: 35, fail: 3, backendLimitation: 2 } },
  sourceHashes: { v1Runner: metadata.originalRunnerSha256, observationOnly: metadata.observationOnlyRunnerSha256, v2Runner: metadata.v2RunnerSha256 },
  maxBytesScope: metadata.maxBytesBoundary,
  state: 'Awaiting peer; no new F29 product pass and no full40/mixed-index approval claimed.',
};
await writeFile(join(root, 'evidence/summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
await writeFile(join(root, 'evidence/integrity-after.json'), `${JSON.stringify({ checkedAt: new Date().toISOString(), originalPreseal: metadata.originalPreseal, sealedArtifactsUnchanged: 54, verifiedHistory, peerCopiesIntact: true, v2RunnerUnchangedDuringMockWiringRepair: true }, null, 2)}\n`, { flag: 'wx' });
await writeFile(join(root, 'evidence/process-state.json'), `${JSON.stringify({ productChildren: 0, nativeChildren: 0, nonproductTestInvocations: 2, bothCompleted: true, nodeTestTimeoutFlagMs: 5000, separateWholeProcessWatchdogClaimed: false, activeOwnedJobs: 0, servers: 0, noFurtherProductAuthorization: true }, null, 2)}\n`, { flag: 'wx' });
await writeFile(join(root, 'evidence/mock-driver-repair.json'), `${JSON.stringify({ originalDriverSha256: hash(await readFile(join(root, 'history/nonproduct-controls-initial.mjs'))), correctedDriverSha256: hash(await readFile(join(root, 'nonproduct-controls.mjs'))), reason: 'Bind missing fileEntry helper in mock context; expose original pre-FS exception rather than masking it with capturedFs assertion; keep failed first output and use a new corrected evidence filename.', productExecutions: 0, runnerChanges: [] }, null, 2)}\n`, { flag: 'wx' });
for (const directory of ['history', 'runner', 'peer', 'evidence']) {
  await mkdir(join(target, directory), { recursive: true });
  for (const name of await readdir(join(root, directory))) {
    assert((await lstat(join(root, directory, name))).isFile());
    await copyFile(join(root, directory, name), join(target, directory, name));
  }
}
await mkdir(join(target, 'tools'), { recursive: true });
for (const name of ['prepare-v2.mjs', 'nonproduct-controls.mjs', 'publish-v2.mjs']) await copyFile(join(root, name), join(target, 'tools', name));
for (const name of ['v2-correction.json', 'observation-only.diff', 'entry-time-assertions.diff']) await copyFile(join(root, name), join(target, name));
const entries = [];
async function collect(relative = '') {
  for (const name of (await readdir(join(target, relative))).sort()) {
    const path = relative ? `${relative}/${name}` : name;
    if (path === 'PUBLICATION.json') continue;
    const info = await lstat(join(target, path));
    assert(!info.isSymbolicLink());
    if (info.isDirectory()) await collect(path);
    else {
      const bytes = await readFile(join(target, path));
      entries.push({ path, bytes: bytes.length, sha256: hash(bytes) });
    }
  }
}
await collect();
const publication = { schema: 1, issue: 'HARN-SIGNAL-001-v2', publishedAt: new Date().toISOString(), peerDecisionPending: true, productExecutions: 0, nativeCalls: 0, originalPreseal: metadata.originalPreseal, v2RunnerSha256: metadata.v2RunnerSha256, artifactCount: entries.length, publicationRootSha256: hash(entries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}\n`).join('')), entries };
await writeFile(join(target, 'PUBLICATION.json'), `${JSON.stringify(publication, null, 2)}\n`, { flag: 'wx' });
await writeFile(join(root, 'publication.json'), `${JSON.stringify(publication, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ artifactCount: publication.artifactCount, publicationRootSha256: publication.publicationRootSha256, v2RunnerSha256: metadata.v2RunnerSha256, nonproductChecks: summary.nonproductChecks, originalAndV1HistoryUnchanged: true, productExecutions: 0, nativeCalls: 0 }, null, 2));
