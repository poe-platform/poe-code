import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const directory = resolve(process.argv[2]);
assert.ok(process.argv[2]);
const load = path => JSON.parse(readFileSync(join(directory, path)));
const review = load('REVIEW.json');
const execution = load('replay/execution.json');
const base = load('replay/base-01/results/results.json');
const supplement = load('replay/supplement-01/results/results.json');
const controls = load('replay/assertion-control-results.json');
const comparisons = load('replay/base-01/results/comparison.json');
assert.equal(review.status, 'replay-complete-awaiting-independent-result-inspection');
assert.deepEqual(review.before, review.after);
assert.equal(execution.candidate, '0123c83d3aae72a15621acbb29a165b97b2c6ab6');
assert.equal(execution.packageSha256, '62228b67ca6793544f0f4374ca00fbbb6e627f514f184d5880fd7723ccf179c6');
assert.equal(execution.forcedCleanup, false);
assert.equal(base.outcomes.length, 77);
assert.ok(base.outcomes.every(row => row.status === 'pass' && row.activeWorkersAfter === 0));
assert.equal(supplement.rows.length, 5);
assert.ok(supplement.rows.every(row => row.status === 'pass'));
const labels = ['borrowed-external-Shell-stdin-return-rejection-not-waived', 'public-registered-grep-reproduces-external-return-failure'];
const corrected = labels.map(label => base.outcomes.find(row => row.label === label));
for (const row of corrected) {
  assert.ok(row);
  assert.equal(row.details.settlement, 'rejected');
  assert.equal(row.details.rejection.identicalSentinel, true);
  assert.equal(Object.hasOwn(row.details, 'result'), false);
  assert.equal(row.details.returns, 1);
}
assert.equal(corrected[0].details.nextCalls, 1);
assert.equal(corrected[1].details.aliasesRegistered, false);
const direct = base.outcomes.filter(row => /^(egrep|fgrep)-direct-return-(throw|reject)$/.test(row.label));
assert.equal(direct.length, 4);
for (const row of direct) { assert.equal(row.details.outcome.result.exitCode, 2); assert.equal(row.details.returns, 1); }
const ownedFile = base.outcomes.find(row => row.label === 'owned-VFS-return-rejection-not-hidden');
assert.equal(ownedFile.details.result.exitCode, 2);
assert.equal(ownedFile.details.result.stderr, 'fgrep: owned-file-return-sentinel\n');
assert.equal(ownedFile.details.returns, 1);
assert.equal(controls.negativeControlsRejected, 8);
assert.equal(controls.positiveControlsAccepted, 2);
assert.equal(controls.productPasses, 0);
assert.equal(review.assertionControls.negativeDetected, 14);
assert.equal(review.assertionControls.positiveAccepted, 2);
const lastAudit = execution.audits.at(-1);
const consumer = lastAudit.consumers.find(row => row.consumer === execution.consumer);
assert.ok(consumer);
const worker = consumer.bindings.find(row => row.path === 'dist/commands/regex-execution/worker.js');
assert.equal(worker.sha256, 'bb568433f1194d957dd14d1eb8229e9733bd13cd42db7ca5f2ac77b5f739b8f7');
for (const [events, identity, location, count] of [[base.workerEvents, 'threadId', 'detail', 86], [supplement.events, 'workerThreadId', 'path', 5]]) {
  const created = events.filter(row => row.event === 'create'), exited = events.filter(row => row.event === 'exit');
  const ids = rows => rows.map(row => row[identity]).sort((left, right) => left - right);
  assert.equal(created.length, count);
  assert.equal(new Set(ids(created)).size, count);
  assert.deepEqual(ids(created), ids(exited));
  assert.ok(created.every(row => row[location] === worker.actualResolvedUrl));
}
assert.equal(base.activeWorkers + supplement.activeWorkers + base.lateErrorCount + base.forcedWorkerTerminationByVerifier + supplement.verifierForcedWorkerTermination, 0);
assert.equal(base.aliasUrl, consumer.bindings.find(row => row.path === 'dist/commands/grep-aliases/index.js').actualResolvedUrl);
assert.equal(execution.publicRootResolutionBeforeImport, consumer.bindings.find(row => row.path === 'dist/index.js').actualResolvedUrl);
assert.equal(execution.cohorts.length, 2);
for (const cohort of execution.cohorts) {
  assert.equal(cohort.processStatus, 0);
  assert.equal(cohort.receipt.forcedCleanup, false);
  assert.equal(cohort.receipt.commands.find(row => row.name === 'strict-types').status, 0);
  assert.ok(cohort.receipt.commands.every(row => row.status === 0 && row.signal === null && row.error === null));
}
for (const audit of execution.audits) {
  assert.equal(audit.allGitBlobsVerified, true);
  assert.equal(audit.additionDetectingInventories, true);
  assert.equal(audit.gitEntries, 27687);
  assert.deepEqual(audit.completeSource, lastAudit.completeSource);
  assert.equal(audit.packageSha256, execution.packageSha256);
}
assert.deepEqual([comparisons.denominator, comparisons.executed, comparisons.bsdExact, comparisons.gnuExact, comparisons.gnuPayloadProjectionOnly], [26, 26, 16, 0, 26]);
assert.equal(comparisons.stderrStripped, false);
const verdict = {
  status: 'independent-scoped-fixture-v2-accepted', candidate: execution.candidate,
  fixtureFreeze: review.preparation, authorEvidence: review.evidence,
  packageSha256: execution.packageSha256, archiveSha256: lastAudit.archiveSha256,
  base: { pass: 77, fail: 0 }, supplement: { pass: 5, fail: 0 },
  historical: { pass: 80, fail: 2, unchanged: true, notRerun: true },
  correctedCases: corrected, directStatus2Controls: direct.length, ownedFileStatus2Control: true,
  authorAssertionControls: { negativeRejected: 8, positiveAccepted: 2, productPasses: 0 },
  independentAssertionControls: { negativeRejected: 14, positiveAccepted: 2, productPasses: 0 },
  workers: { created: 91, exited: 91, active: 0, forcedTermination: 0 },
  strictCompilations: 2, authenticatedAuthorFiles: review.before.length,
  completeSource: lastAudit.completeSource, gitEntries: lastAudit.gitEntries, movedPackage: consumer,
  nativeProfiles: { newNativeExecutions: 0, historicalDarwinBsdExact: '16/26', historicalDarwinGnuExact: '0/26', gnuStdoutStatusEffectsProjection: '26/26', stderrStripped: false },
  startedAt: review.startedAt, endedAt: review.endedAt, productSourceChanges: false,
  sourceOverlay: false, newBuild: false, newPack: false, publicAliasSubpathAccepted: false,
  integration: 'HOLD pending explicit root authorization',
};
if (process.argv.includes('--verify')) assert.deepEqual(load('VERDICT.json'), verdict);
else writeFileSync(join(directory, 'VERDICT.json'), JSON.stringify(verdict, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: verdict.status, candidate: verdict.candidate, base: verdict.base, supplement: verdict.supplement, workers: verdict.workers, authorFiles: verdict.authenticatedAuthorFiles }));
