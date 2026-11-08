import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import {createGzip, createGunzip} from 'node:zlib';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../../../..');
const output = '/private/tmp/full-gate-unified76-f5-fe15-finalroutes-20260828-r1';
const outer = '/private/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/unified76-supervisor-lAnYPa';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.deepEqual(process.argv.slice(2), ['--capture-existing-attempt']);
const report = JSON.parse(readFileSync(join(output, 'REPORT.json')));
const supervisor = JSON.parse(readFileSync(join(outer, 'REPORT.json')));
assert.equal(report.candidate, 'f5e9fc49b6abb38e180cc9de16c95fced102ff75');
assert.deepEqual(report.phases, []); assert.equal(report.driverProductionBuilds, 0);
assert.equal(report.error.message, 'spawnSync git EPERM'); assert.equal(supervisor.result.status, 1);
assert.equal(supervisor.result.closed, true); assert.deepEqual(supervisor.result.signals, []);
assert.deepEqual(supervisor.result.survivors, []); assert.deepEqual(supervisor.fence.observerReceipt.survivors, []);
const rawDirectory = join(directory, 'raw-v1'); assert.ok(!existsSync(rawDirectory)); mkdirSync(rawDirectory);
const sources = [
  ...['ADMISSION.json', 'REPORT.json'].map(name => ({role: 'inner', path: join(output, name), name})),
  ...['OS-FENCE-RESULT.json', 'OS-FENCE.json', 'REPORT.json', 'stdout', 'stderr'].map(name => ({role: 'outer', path: join(outer, name), name})),
];
let total = 0;
const index = [];
for (const entry of sources) {
  const before = lstatSync(entry.path); assert.ok(before.isFile() && !before.isSymbolicLink());
  assert.ok(before.size <= 32 * 1024 * 1024); total += before.size; assert.ok(total <= 64 * 1024 * 1024);
  const digest = createHash('sha256'); let count = 0;
  const destination = `${entry.role}-${entry.name}.gz`;
  const meter = new Transform({transform(chunk, encoding, callback) { count += chunk.length; if (count > before.size) return callback(new Error('raw capture grew')); digest.update(chunk); callback(null, chunk); }});
  await pipeline(createReadStream(entry.path, {highWaterMark: 64 * 1024}), meter, createGzip(), createWriteStream(join(rawDirectory, destination), {flags: 'wx'}));
  assert.equal(count, before.size);
  const after = lstatSync(entry.path); assert.deepEqual([after.dev, after.ino, after.size, after.mtimeMs, after.mode], [before.dev, before.ino, before.size, before.mtimeMs, before.mode]);
  const compressed = readFileSync(join(rawDirectory, destination)); const rawSha256 = digest.digest('hex');
  const verifyHash = createHash('sha256'); let verifiedBytes = 0;
  await pipeline(createReadStream(join(rawDirectory, destination)), createGunzip(), new Transform({transform(chunk, encoding, callback) { verifiedBytes += chunk.length; if (verifiedBytes > before.size) return callback(new Error('decompressed evidence exceeds source')); verifyHash.update(chunk); callback(); }}));
  assert.equal(verifiedBytes, before.size); assert.equal(verifyHash.digest('hex'), rawSha256);
  index.push({...entry, bytes: count, mode: before.mode & 0o777, sha256: rawSha256, captured: 'raw-v1/' + destination, compressedBytes: compressed.length, compressedSha256: sha(compressed)});
}
const helperPath = 'tests/integration/full-gate-20260827/combined-8670ebe8/prerequisites.mjs';
const stagedHelper = join(report.temporary, 'support', helperPath);
const helperBytes = readFileSync(stagedHelper);
const packet = JSON.parse(readFileSync(join(repository, 'tests/integration/full-gate-20260827/unified76-driver/release-packet-v2-final-routes/PACKET.json')));
assert.equal(sha(helperBytes), packet.profile.support[helperPath]);
const source = join(report.temporary, 'source');
const omissions = [...packet.projection.candidateEntries.map(entry => join(source, entry.path)), ...packet.projection.dependencyEntries.map(entry => join(source, 'benchmarks/node_modules', entry.path))];
for (const path of omissions) assert.equal(existsSync(path), false);
assert.equal(existsSync(join(report.temporary, 'safejs-engine')), false);
assert.equal(existsSync(join(output, 'SETUP-COMPLETE.json')), false);
for (const entry of packet.driver.files) assert.equal(sha(readFileSync(join(repository, entry.path))), entry.sha256);
for (const root of report.osInstructionFence.roots) {
  const stat = lstatSync(root.path); assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  assert.equal(realpathSync(root.path), root.path);
  assert.deepEqual([stat.dev, stat.ino, stat.mode & 0o777, stat.uid], [root.device, root.inode, root.mode, root.uid]);
}
const summary = {
  capturedAt: new Date().toISOString(), candidate: report.candidate, driverSha256: report.driverSha256, profileSha256: report.profileSha256,
  rootAuthorizationCommit: '8e6b40ecd2cec2b6dcaf2ce80c0cff477d39e6eb', toolSession: 92296, launcherInvocations: 1, launcherExit: 1,
  status: 'HOLD_OR_QUALIFIED_RED', startedAt: report.startedAt, finishedAt: report.finishedAt, error: report.error,
  phaseOutcomes: packet.phases.map(phase => ({...phase, outcome: 'NOT_EXECUTED', reason: 'setup authority Git route refused before first phase'})),
  productionBuilds: 0, canonicalTestsExecuted: 0, canonicalCounts: null, packageRebuilt: false,
  preflight: {status: report.preflight.status, issues: report.preflight.issues, nativeBindings: report.external.native, readableBindingsVerified: report.external.readableBindingsVerified},
  setup: {logicalEntries: report.archive.logical.count, physicalEntries: report.archive.count, historyBytes: report.historyTransport.bytes, checkoutPerformed: report.historyTransport.checkoutPerformed, omittedInstructionPathsAbsent: omissions, nativeStagedExecutableCopies: report.nativeStaged.length, helper: {path: helperPath, staged: stagedHelper, bytes: helperBytes.length, sha256: sha(helperBytes)}, finalSweepReached: false, setupSentinelAbsent: true},
  private: {metadataAdmission: report.privateCopyAdmission, beforeStateReached: Object.hasOwn(report, 'privateBefore'), afterStateReached: Object.hasOwn(report, 'privateAfter'), engineCopyExists: false, guestExecutions: 0, qualification: 'Metadata-only would-copy preflight reached. Failure precedes helper privateState/engine body copy. No private pre/post identity claim is inferred.'},
  cleanup: {workerClosed: supervisor.result.closed, workerProcessClean: supervisor.result.clean, signals: supervisor.result.signals, survivors: supervisor.result.survivors, observerSurvivors: supervisor.fence.observerReceipt.survivors, completedSupervisedPhases: supervisor.fence.phaseReceipt.completed, phaseProtocolClean: supervisor.fence.phaseReceipt.clean, aggregateFenceClean: supervisor.fence.clean, qualification: 'Natural owned-process closure, but phase protocol/final gate cleanup completeness is false because all phases are unreached; no kernel-hard drain claim.'},
  retained: {output, outer, workRoot: report.osInstructionFence.roots[0], temporary: report.temporary, rawFiles: index.length, rawBytes: total, fullSnapshotRemoved: false, qualification: 'Exact failed-attempt trees retained for authorized inspection; no new full snapshot or instruction-body evidence copy.'},
  integrity: {shipping38Unchanged: true, checkedSixInstructionPathsAbsent: true, originalOutputFiles: readdirSync(output).sort(), finalProductPackagePrivateSweeps: 'NOT_REACHED', qualification: 'Setup archive proof and bounded terminal checks only, not completed whole-gate immutability qualification.'},
  diagnosis: {confirmed: 'prerequisites receives environment but line22 execFileSync git supplies cwd only; inherited process.env is used rather than the verified local PATH. privateGit line10 also uses process.env and was not reached.', inference: 'The bare Git refusal is consistent with the blocked /usr/bin/git selector route; the failed exec has no resolved-absolute-path receipt, so that specific target is not asserted as dynamically observed.', nextDecision: 'A separately authorized versioned driver environment/routing repair and review would be needed; no helper body, permission, source/profile or receipt is changed by this capture.'},
};
writeFileSync(join(directory, 'RAW-INDEX.json'), JSON.stringify({capturedAt: summary.capturedAt, files: index}, null, 2) + '\n', {flag: 'wx'});
writeFileSync(join(directory, 'TERMINAL.json'), JSON.stringify(summary, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({files: index.length, rawBytes: total, status: summary.status, phases: '0/14', builds: 0, retries: 0, retainedWorkRoot: summary.retained.workRoot.path}));
