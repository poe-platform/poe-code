import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sha256, objectId } from './review-reference.mjs';

const own = path.dirname(fileURLToPath(import.meta.url)), repository = path.resolve(own, '../../../..');
const read = name => JSON.parse(fs.readFileSync(path.join(own, name)));
const receipt = read('review-02.json'), first = read('review-01.json'), seal = read('RUNNER-SEAL-V2.json');
const authorEvidenceCommit = 'd3817018efd58d7a6e319192ef388aff7c9cc2cd';
const metadataChildren = [];
function git(args) {
  const started = Date.now(), run = spawnSync('/usr/bin/git', ['--no-replace-objects', ...args], { cwd: repository, timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024, env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0' } });
  assert.equal(run.error, undefined); assert.equal(run.status, 0); assert.equal(run.signal, null);
  metadataChildren.push({ args, pid: run.pid, elapsedMs: Date.now() - started, timeoutMs: 10000, status: run.status, signal: run.signal, stdoutBytes: run.stdout.length, stdoutSha256: sha256(run.stdout), stderrBytes: run.stderr.length, exactChildReaped: true });
  return run.stdout;
}
const authorCommitBody = git(['cat-file', 'commit', authorEvidenceCommit]); assert.equal(objectId('commit', authorCommitBody), authorEvidenceCommit);
const names = ['REPORT.md', 'runs/data-01/RESULT.json'];
const authorRoot = path.resolve(own, '../path-transport-v2');
const listing = git(['ls-tree', '-rz', '--full-tree', authorEvidenceCommit, '--', ...names.map(name => path.relative(repository, path.join(authorRoot, name)))]);
const authorEvidence = [];
for (const record of listing.toString().split('\0').filter(Boolean)) {
  const match = /^(100644) blob ([0-9a-f]{40})\t(.+)$/.exec(record); assert.ok(match);
  const bytes = fs.readFileSync(path.join(repository, match[3])), mode = fs.lstatSync(path.join(repository, match[3])).mode & 0o777;
  assert.equal(objectId('blob', bytes), match[2]); assert.equal(mode, 0o644);
  authorEvidence.push({ path: match[3], bytes: bytes.length, mode, sha256: sha256(bytes), blob: match[2] });
}
assert.equal(authorEvidence.length, 2);
const authorResult = JSON.parse(fs.readFileSync(path.join(authorRoot, 'runs/data-01/RESULT.json')));
assert.equal(authorResult.results.length, 65); assert.ok(authorResult.results.every(row => row.status === 'PASS'));
for (const entry of seal.entries) {
  const filename = path.resolve(repository, entry.path), stat = fs.lstatSync(filename); assert.equal(stat.mode & 0o777, entry.mode); assert.ok(!stat.isSymbolicLink());
  if (entry.type === 'directory') assert.deepEqual(fs.readdirSync(filename).sort(), entry.names);
  else { const bytes = fs.readFileSync(filename); assert.equal(bytes.length, entry.bytes); assert.equal(sha256(bytes), entry.sha256); assert.equal(objectId('blob', bytes), entry.blob); }
}
const firstQualified = first.observations.results.map(row => row.error?.code === 'ERR_ACCESS_DENIED' ? { id: row.id, status: 'NOT_RUN', reason: 'Verifier fixture preparation permission failure; original verdict invalidated', originalStatus: row.status } : { id: row.id, status: row.status });
assert.equal(firstQualified.filter(row => row.status === 'NOT_RUN').length, 127);
assert.equal(firstQualified.filter(row => row.status === 'PASS').length, 78);
const retained = [];
for (const name of fs.readdirSync(own).sort()) {
  assert.ok(!name.startsWith('.data-'), 'owned work must be gone');
  const filename = path.join(own, name), stat = fs.lstatSync(filename); assert.ok(stat.isFile());
  const bytes = fs.readFileSync(filename); retained.push({ path: name, bytes: bytes.length, mode: stat.mode & 0o777, sha256: sha256(bytes) });
}
const totalElapsedMs = Date.now() - Date.parse(first.started); assert.ok(totalElapsedMs < 900000, 'overall review execution window');
const final = {
  schema: 'independent-path-transport-v2-final-review-v1',
  classification: 'HARNESS ONLY; DATA/SYNTHETIC and development Git metadata; no actual future GO',
  verdict: 'HOLD_UNQUALIFIED_ACCEPTANCE',
  demonstrated: 'Complete stored-tree/path transport for the declared strict-UTF8 sealed-inventory profile',
  repairSourceCommit: seal.repairCommit,
  authorEvidenceCommit,
  authorEvidenceCommitTree: authorCommitBody.toString().split('\n')[0].slice(5),
  authorEvidence,
  productSourceCommit: receipt.productSourceCommit,
  productEvidenceCommit: receipt.productEvidenceCommit,
  executionSealSha256: receipt.executionSealSha256,
  independentPreparationCommit: seal.preparationCommit,
  runnerPresealCommit: receipt.runnerPresealCommit,
  runnerSealSha256: receipt.runnerSealSha256,
  initialRunnerPresealCommit: first.runnerPresealCommit,
  initialEvidenceCommit: '655bfba476e82dd0843f67ed9f86c4ff9af3c56b',
  finalEvidenceCommit: 'Reported externally: the atomic commit containing this file; no self-reference',
  cohortSeparation: {
    author: { prepared: 65, reportedPass: 65, independentReplay: false, classification: 'Authenticated committed evidence, not our controls' },
    independentPreparation: { controls: 206, actualPathIdentities: 98, historicalSourceFiles: 12, historicalDataFiles: 19, consumerSites: 21, originalMetadataChildren: 3, candidateExecutionsAtPreparation: 0 },
    initialAttemptQualified: { dynamic: 79, PASS: 78, UNSUPPORTED: 1, NOT_RUN: 127, fixtureBlocked: 120, invalidatedNegativePasses: 21, cases: firstQualified },
    correctedAttempt: { dynamic: receipt.observations.dynamicDenominator, ...receipt.observations.counts, unique206Outcomes: receipt.observations.results },
    historical: { DATA: 25, NOT_RUN: 68, unchanged: true },
    noSummedAcceptanceDenominator: true,
  },
  findings: [
    { id: 'C18', status: 'FAIL', boundary: 'Actual readCapture consumes referenced files, accepts unreferenced sixth record file', controllerBypassDemonstrated: false, qualification: 'Existing controller inventory-v1 append guard is SOURCEONLY. Do not label this full-controller acceptance.', beforeFreshRootGo: 'Close consumed-capture boundary or supply concrete independent proof of existing composed append gate and explicit root narrow-contract acceptance; preserve failed control.' },
    { id: 'P28', status: 'UNSUPPORTED', boundary: 'Invalid UTF8 raw-byte preservation expected; declared strict-UTF8 decoder refuses', priorDeclaredScope: true, beforeFreshRootGo: 'Root must explicitly accept strict-UTF8 finite profile or require raw-byte support/new exact repair seal/review. No silent narrowing.' },
  ],
  notRunSourceOnly: receipt.observations.results.filter(row => row.status === 'NOT_RUN'),
  sourceOnlyFutureChecks: ['controller integration', 'inline OID request construction', 'declared count gate', 'full directory append admission', 'module loader', 'read-permission routes', 'package882', 'BUILD-RECEIPT', 'concrete app/loader/worker hashes', 'committed RUNTIME-SEAL then RUNTIME-START'],
  treeAndObjectProof: receipt.observations.facts,
  actual98CorrectedPasses: receipt.observations.results.filter(row => row.id.startsWith('H') && row.status === 'PASS').length,
  authenticatedBindings: { ...receipt.before, afterEqual: JSON.stringify(receipt.before) === JSON.stringify(receipt.after), finalReauthentication: true },
  finalMetadataChildren: metadataChildren,
  executionBudget: { limitMs: 900000, totalElapsedThroughFinalAuthenticationMs: totalElapsedMs, launchWindowMs: receipt.elapsedMs, dataChildren: 2, freezeMetadataChildren: 8, launchMetadataChildren: 2, finalMetadataChildren: metadataChildren.length, metadataChildrenTotalThisReview: 10 + metadataChildren.length, interactiveGitToolingSeparate: true, serial: true, dataChildLimitMs: 30000, metadataChildLimitMs: 10000, allRecordedChildrenReaped: true, firstAndSecondLaunchCapturedBytes: first.budget.capturedBytes + receipt.budget.capturedBytes, finalMetadataCapturedBytes: metadataChildren.reduce((total, child) => total + child.stdoutBytes + child.stderrBytes, 0), syntheticWorkBytes: receipt.cleanup.bytesRemoved, syntheticFilesCleaned: receipt.cleanup.filesRemoved, captureLimitBytes: 134217728, workLimitBytes: 536870912, qualification: 'Accounting, not RSS or global CLI peak; snapshots/hash reads are not working-memory measurements' },
  cleanup: { firstAbsent: first.cleanup.absent, secondAbsent: receipt.cleanup.absent, noOwnedTemporaryDirectory: true, persistentResources: 0 },
  unchangedFutureInterface: { selectedCount: 274, futurePackageCount: 882, futureJobs: 70, controllerMs: 6600000, buildExecuted: false, generatedJsHashes: null, binding: 'Derived selected source/config/tool inputs -> complete BUILD-RECEIPT package/emissions -> exact app/loader/worker/mutations -> committed RUNTIME-SEAL -> RUNTIME-START; no actual GO' },
  forbiddenExecutionCounts: { compiler: 0, build: 0, install: 0, product: 0, runtimeController: 0, loaderInstallation: 0, network: 0, nativeOracle: 0, mutants: 0, instructionPlaintextSnapshots: 0 },
  originalPreseal8Unchanged: true,
  retainedFilesBeforeFinalJson: retained,
  retainedBytesBeforeFinalJson: retained.reduce((total, entry) => total + entry.bytes, 0),
};
for (const entry of authorEvidence) {
  const filename = path.join(repository, entry.path), bytes = fs.readFileSync(filename);
  assert.equal(sha256(bytes), entry.sha256); assert.equal(fs.lstatSync(filename).mode & 0o777, entry.mode);
}
assert.equal(fs.existsSync(path.join(own, 'FINAL.json')), false);
const serialized = JSON.stringify(final, null, 2);
assert.ok(Buffer.byteLength(serialized) + final.retainedBytesBeforeFinalJson < 128 * 1024 * 1024);
const patch = `*** Begin Patch\n*** Add File: ${path.relative(repository, path.join(own, 'FINAL.json'))}\n${serialized.split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`;
const applied = spawnSync('apply_patch', [], { cwd: repository, input: patch, timeout: 10000, maxBuffer: 1024 * 1024, encoding: 'utf8' }); assert.equal(applied.status, 0, applied.stderr);
console.log(JSON.stringify({ verdict: final.verdict, totalElapsedMs, sourceBindings: seal.entries.length, actual98Passes: final.actual98CorrectedPasses, dynamic: receipt.observations.dynamicDenominator, counts: receipt.observations.counts, retainedBytes: final.retainedBytesBeforeFinalJson + Buffer.byteLength(serialized) + 1, finalSha256: sha256(fs.readFileSync(path.join(own, 'FINAL.json'))) }));
