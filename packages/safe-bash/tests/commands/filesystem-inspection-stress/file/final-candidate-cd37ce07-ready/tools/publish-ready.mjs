import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, readlink, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const repository = '/Users/kjopek/Workspace/safe-bash';
const target = join(repository, 'tests/commands/filesystem-inspection-stress/file/final-candidate-cd37ce07-ready');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const save = async (path, value) => writeFile(join(root, path), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const peerPath = '/tmp/safe-bash-inspection-safety-prep-detail.txt';
let peerPresent = true;
try { await lstat(peerPath); } catch (error) { if (error.code !== 'ENOENT') throw error; peerPresent = false; }
assert.equal(peerPresent, false, 'Peer report arrived; inspect it manually before publishing a missing-report checkpoint');
await save('gate.json', { checkedAt: new Date().toISOString(), requiredReport: peerPath, present: false, authorized: false, decision: 'STOP_READY_NO_PRODUCT_OR_NATIVE_CALLS', requiredScope: ['explicit GO final F29v2', 'explicit GO F33/F34 corrections', 'exact published final runner hash'], requiredRunnerSha256: 'de11b74f47288916cd7fd486e91754465e53963ae0bc63c9d4a309ee2e77e756', earlierF33F34ScopedGoDoesNotAuthorizeFull40: true });
const catalog = JSON.parse(await readFile(join(root, 'holdout/seal-catalog.json')));
for (const entry of catalog.artifacts) {
  const path = join(root, 'holdout', entry.relativePath);
  const metadata = await lstat(path);
  assert(entry.type === 'symlink-target' ? metadata.isSymbolicLink() : metadata.isFile());
  const bytes = entry.type === 'symlink-target' ? Buffer.from(await readlink(path)) : await readFile(path);
  assert.equal(bytes.length, entry.bytes, path);
  assert.equal(hash(bytes), entry.sha256, path);
}
await save('cohort-status.json', { status: 'NOT_STARTED', freshProductCases: 0, reusedProductCasesAsFinalEvidence: 0, pendingProductCases: 40, contentAssertionsExecuted: 0, finalNativeComparisons: 0, nativeCalls: 0, historicalNativeObservationsRetained: 109, newRawFailureIds: [], rawFailureIdsQualification: 'No product calls, not an all-pass result', initialHistoricalRaw: { pass: 35, fail: 3, backendLimitations: 2, failureIds: ['F29', 'F33', 'F34'] }, initialHistoricalAdjudicated: { pass: 31, nativeProfileConflict: 4, harnessDefect: 3, backendLimitations: 2, profileConflictIds: ['F07', 'F12', 'F16', 'F18'], backendLimitationIds: ['F30', 'F31'] }, initialHistoricalContent: { semanticAccepted: 80, semanticTotal: 80, exactMachine: 50, machineTotal: 60 }, oldCorrected3Historical: { rawPass: 3, ids: ['F29', 'F33', 'F34'], peerF29: 'HOLD-v1-post-settlement-liveness', peerF33F34: 'scoped GO historical only', F33: { next: 1, return: 1, lateReadInjection: 1, observedWindow: 1 }, F34: { next: 1, return: 1, lateReadInjection: 1, lateReturnInjection: 1, observedWindow: 1 }, qualification: 'Copied historical facts, not fresh or final-source evidence' }, cases: Array.from({ length: 40 }, (_, index) => ({ id: `F${String(index + 1).padStart(2, '0')}`, state: 'NOT_RUN_PENDING_PEER_GO', attempts: 0, reusedAsFinalEvidence: false })) });
await save('process-state.json', { recordedAt: new Date().toISOString(), buildChildrenStarted: 1, buildChildrenSettled: 1, buildTimedOut: false, productChildrenStarted: 0, productChildrenRemaining: 0, nativeChildrenStarted: 0, productModulesLoaded: 0, loadedEntries: [], nativeCalls: 0, productCleanupAndLateInjection: 'NOT_EXERCISED_THIS_PHASE', backgroundWorkersStarted: 0, retryCount: 0, consumerCalls: 0, fullGateRuns: 0, stagedPaths: [], commitsCreated: 0 });
await writeFile(join(root, 'shell-source.diff'), execFileSync('git', ['diff', 'd168d18b118592e04a6eec9b00eb50cc2b1e5058', 'cd37ce07c1f41f3797e19e0f701b662823338843', '--', 'src/shell/shell.ts'], { cwd: repository, timeout: 60000 }), { flag: 'wx' });
await mkdir(target);
const files = ['README.md', 'STATIC_REVIEW.md', 'freeze.json', 'build.json', 'build.stdout.txt', 'build.stderr.txt', 'history-before.json', 'history-after.json', 'snapshot-integrity.json', 'static-closure.json', 'source-deltas.json', 'ready-binding.json', 'sqlite-source.diff', 'text-source.diff', 'shell-source.diff', 'author-handoff.txt', 'gate.json', 'cohort-status.json', 'process-state.json'];
for (const path of files) await copyFile(join(root, path), join(target, path));
await mkdir(join(target, 'tools'));
for (const path of ['freeze.mjs', 'build.mjs', 'verify-history.mjs', 'prepare-evidence.mjs', 'publish-ready.mjs']) await copyFile(join(root, path), join(target, 'tools', path));
await mkdir(join(target, 'runner'));
await copyFile(join(root, 'holdout/v2-runner.mjs'), join(target, 'runner/v2-runner.mjs'));
const entries = [];
async function collect(directory = '') {
  for (const name of (await readdir(join(target, directory))).sort()) {
    const path = join(directory, name);
    const metadata = await lstat(join(target, path));
    if (metadata.isDirectory()) await collect(path);
    else {
      assert(metadata.isFile());
      const bytes = await readFile(join(target, path));
      entries.push({ path, bytes: bytes.length, sha256: hash(bytes) });
    }
  }
}
await collect();
const publication = { schema: 1, publishedAt: new Date().toISOString(), status: 'READY_NOT_EXECUTED_PEER_REPORT_ABSENT', candidateCommit: 'cd37ce07c1f41f3797e19e0f701b662823338843', sourceSha256: 'f9276a3524347ec20030d41c25d2d5bc033471437b7a9749094585b17693ce0c', dependencySha256: 'cda0820b8443488b19d0747cb97de37f8aec7492747bff286705a33f6026402e', runnerSha256: 'de11b74f47288916cd7fd486e91754465e53963ae0bc63c9d4a309ee2e77e756', freshProductCases: 0, reusedProductCasesAsFinalEvidence: 0, nativeCalls: 0, dependenciesVendored: false, artifactCount: entries.length, publicationRootSha256: hash(entries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}\n`).join('')), entries };
await writeFile(join(target, 'PUBLICATION.json'), `${JSON.stringify(publication, null, 2)}\n`, { flag: 'wx' });
await save('publication.json', publication);
for (const entry of entries) assert.equal(hash(await readFile(join(target, entry.path))), entry.sha256, entry.path);
console.log(JSON.stringify({ target, artifactCount: entries.length, publicationRootSha256: publication.publicationRootSha256, freshProductCases: 0, nativeCalls: 0 }, null, 2));
