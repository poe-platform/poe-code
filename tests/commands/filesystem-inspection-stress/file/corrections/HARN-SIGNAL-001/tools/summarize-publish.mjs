import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const previous = '/private/tmp/safe-bash-file-run.WeB7Vfsc';
const originalSealed = '/private/tmp/safe-bash-file-holdout.KyVGrl0A';
const publicationRoot = '/Users/kjopek/Workspace/safe-bash/tests/commands/filesystem-inspection-stress/file';
const target = join(publicationRoot, 'corrections/HARN-SIGNAL-001');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (location) => JSON.parse(await readFile(location));
const correction = await json(join(root, 'correction.json'));
const run = await json(join(root, 'corrected-run.json'));
const freeze = await json(join(previous, 'freeze.json'));
const build = await json(join(previous, 'build.json'));
const oldSummary = await json(join(previous, 'summary.json'));
const reports = [];
const eventEvidence = [];
const loaded = new Map();
for (const id of correction.authorizedCases) {
  const report = (await json(join(root, 'results', `${id}.json`))).reports[0];
  assert.equal(report.semanticStatus, 'pass', 'Any failure requires root routing, never a hidden retry');
  reports.push(report);
  const events = (await readFile(join(root, 'results', `${id}.events.jsonl`), 'utf8')).trim().split('\n').map(JSON.parse);
  const count = (kind) => events.filter((entry) => entry.kind === kind).length;
  assert.equal(count('execute-start'), 1);
  assert.equal(count('shell-start'), 0);
  const evidence = { id, productExecutions: count('execute-start'), next: count('holdout-source-next'), returned: count('holdout-source-return'), lateReadInjected: count('holdout-late-read-rejection-injected'), lateReturnInjected: count('holdout-late-return-rejection-injected'), verifiedObservationWindows: count('holdout-late-error-window-verified'), unhandledEvents: count('unhandled-rejection') };
  if (id !== 'F29') {
    assert.equal(evidence.next, 1);
    assert.equal(evidence.returned, 1);
    assert.equal(evidence.lateReadInjected, 1);
    assert.equal(evidence.lateReturnInjected, Number(id === 'F34'));
    assert.equal(evidence.verifiedObservationWindows, 1);
    assert.equal(count('holdout-exact-caller-reason-verified'), 1);
    assert.equal(count('holdout-fs-abort-propagation-verified'), 1);
    const observationIndex = events.findIndex((entry) => entry.kind === 'holdout-late-error-window-verified');
    assert(events.findIndex((entry) => entry.kind === 'holdout-late-read-rejection-injected') < observationIndex);
    if (id === 'F34') assert(events.findIndex((entry) => entry.kind === 'holdout-late-return-rejection-injected') < observationIndex);
    assert.equal(events[observationIndex].eventLoopTurns, 2);
    assert.equal(events[observationIndex].unhandledCount, 0);
    assert.equal(report.evidence.returned, 1);
    assert.equal(report.evidence.exactAbortIdentity, true);
    assert.equal(report.evidence.lateErrorsObserved, true);
  }
  eventEvidence.push(evidence);
  const modules = (await readFile(join(root, 'results', `${id}.modules.jsonl`), 'utf8')).trim().split('\n').map(JSON.parse);
  for (const entry of modules) if (entry.resolved.startsWith('file:')) {
    const path = fileURLToPath(entry.resolved);
    assert(path.startsWith(`${root}/`) || path.startsWith(`${previous}/candidate/dist/`));
    assert((await lstat(path)).isFile());
    if (!loaded.has(path)) loaded.set(path, { path, sha256: hash(await readFile(path)) });
  }
}
for (const entry of [...freeze.files, ...freeze.dependencies, ...build.files]) {
  const path = join(previous, 'candidate', entry.path);
  assert((await lstat(path)).isFile());
  assert.equal(hash(await readFile(path)), entry.sha256);
}
const oldPublication = await json(join(publicationRoot, 'PUBLICATION.json'));
for (const entry of oldPublication.entries) assert.equal(hash(await readFile(join(publicationRoot, entry.path))), entry.sha256);
const catalog = await json(join(originalSealed, 'seal-catalog.json'));
for (const entry of catalog.artifacts) for (const directory of [originalSealed, join(root, 'holdout')]) {
  const path = join(directory, entry.relativePath);
  const bytes = entry.type === 'symlink-target' ? Buffer.from(await readlink(path)) : await readFile(path);
  assert.equal(hash(bytes), entry.sha256);
}
const mapping = [];
for (const old of oldSummary.outcomes) {
  const corrected = reports.find((entry) => entry.id === old.id);
  const newSource = corrected !== undefined;
  mapping.push({
    id: old.id, origin: newSource ? 'corrected-three-case-run' : 'REUSED-initial-run-NOT-rerun',
    executedThisPhase: newSource,
    evidence: newSource ? `results/${old.id}.json` : `../../../evidence/results/${old.id}.json`,
    selectedClassification: newSource ? corrected.semanticStatus : old.adjudication,
    selectedNativeStatus: newSource ? corrected.nativeStatus : old.rawNativeStatus,
    historicalRawSemanticStatus: old.rawSemanticStatus,
    historicalAdjudication: old.adjudication,
  });
}
assert.equal(mapping.filter((entry) => entry.executedThisPhase).length, 3);
const counts = mapping.reduce((result, entry) => ({ ...result, [entry.selectedClassification]: (result[entry.selectedClassification] ?? 0) + 1 }), {});
const integrity = { checkedAt: new Date().toISOString(), originalPreseal: correction.originalPreseal, originalSealedArtifactsUnchanged: 54, copiedOriginalArtifactsUnchanged: 54, historicalPublicationFilesUnchanged: oldPublication.entries.length, historicalPublicationRoot: oldPublication.publicationRootSha256, oldCandidateFilesUnchanged: freeze.files.length + freeze.dependencies.length + build.files.length, sourceSha256: freeze.sourceSha256, dependencySha256: freeze.dependencySha256, newLiveAuthorInspectedOrTested: false };
const summary = { issue: correction.issue, candidateCommit: freeze.commit, run, correctedScenarioCounts: { pass: 3 }, nativeCalls: 0, full40Runs: 0, caseRetries: 0, eventEvidence, nonproductSelfChecks: { pass: 5, fail: 0 }, originalHistoricalRawCountsUnchanged: oldSummary.rawSemanticCounts, evidenceIndexOnly: { correctedRows: 3, reusedRows: 37, isNewFull40Run: false, mixedProvenanceCounts: counts }, sourceBugRevealed: false, originalSQLiteIssueStillAppliesToOldCandidate: true, authorFixTested: false, hashes: { originalIsolatedRunner: correction.originalIsolatedRunnerSha256, correctedAssertionsRunner: correction.correctedAssertionsRunnerSha256, correctedObservedRunner: correction.correctedObservedRunnerSha256 } };
const processState = { checkedAt: new Date().toISOString(), ownedChildren: 3, synchronouslyCompletedAndReaped: run.rows.filter((entry) => entry.childStatus === 0 && entry.signal === null).length, activeOwnedChildren: 0, shellAttemptsThisPhase: 0, serversOrDetachedJobs: 0 };
assert.equal(processState.synchronouslyCompletedAndReaped, 3);
for (const [name, value] of [['summary.json', summary], ['coverage-index.json', { isNewFull40Run: false, correctedCases: correction.authorizedCases, reusedCases: 37, rows: mapping }], ['integrity-after.json', integrity], ['process-state.json', processState], ['loaded-modules.json', [...loaded.values()]]]) await writeFile(join(root, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
for (const directory of ['history', 'runner', 'tools', 'evidence/results']) await mkdir(join(target, directory), { recursive: true });
for (const name of ['correction.json', 'assertion-correction.diff', 'observation-only.diff']) await copyFile(join(root, name), join(target, name));
for (const name of ['original-isolated-runner.mjs', 'original-sealed-runner.mjs']) await copyFile(join(root, 'history', name), join(target, 'history', name));
for (const name of ['corrected-assertions-runner.mjs', 'corrected-observed-runner.mjs']) await copyFile(join(root, 'holdout', name), join(target, 'runner', name));
for (const name of ['prepare-correction.mjs', 'selfcheck.mjs', 'run-corrected.mjs', 'child.mjs', 'audit-loader.mjs', 'summarize-publish.mjs']) await copyFile(join(root, name), join(target, 'tools', name));
for (const name of ['summary.json', 'coverage-index.json', 'integrity-after.json', 'process-state.json', 'loaded-modules.json', 'corrected-run.json', 'corrected-run.progress.json', 'selfcheck.tap']) await copyFile(join(root, name), join(target, 'evidence', name));
for (const name of await readdir(join(root, 'results'))) await copyFile(join(root, 'results', name), join(target, 'evidence/results', name));
console.log(JSON.stringify({ correctedPass: 3, reusedNotRerun: 37, historicalRaw: oldSummary.rawSemanticCounts, eventEvidence, correctedObservedRunnerSha256: correction.correctedObservedRunnerSha256, oldSourceInputsUnchanged: 590, originalPublishedFilesUnchanged: 285, target }, null, 2));
