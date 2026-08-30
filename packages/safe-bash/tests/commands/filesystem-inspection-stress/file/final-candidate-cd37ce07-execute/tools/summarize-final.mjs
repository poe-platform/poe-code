import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const owned = '/Users/kjopek/Workspace/safe-bash/tests/commands/filesystem-inspection-stress/file';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (path) => JSON.parse(await readFile(join(root, path)));
const save = async (path, value) => writeFile(join(root, path), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const jsonLines = async (path) => (await readFile(join(root, path), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const count = (rows, key) => rows.reduce((counts, row) => {
  counts[row[key]] = (counts[row[key]] ?? 0) + 1;
  return counts;
}, {});
const run = await json('final-run.json');
const freeze = await json('freeze.json');
const build = await json('build.json');
const binding = await json('binding.json');
const originalCases = (await json('holdout/cases.json')).cases;
const expectations = await json('holdout/expectations.json');
const fixtures = await json('holdout/fixture-manifest.json');
const native = await json('holdout/native-observations.json');
const compiled = new Map(build.files.map((entry) => [`candidate/${entry.path}`, entry.sha256]));
const reports = [];
const outcomes = [];
const viewRows = [];
const eventCounts = {};
const fsMethods = {};
const loadedFiles = new Map();
const productBuiltins = new Set();
const perCase = [];
const lifecycle = [];
const priorDifferences = [];
const history = [];
for (const child of run.rows) {
  assert.equal(child.status, 0, child.id);
  assert.equal(child.reportExists, true, child.id);
  const document = await json(`results/${child.id}.json`);
  assert.equal(document.candidate.commit, freeze.commit);
  assert.equal(document.candidate.sourceSha256, freeze.sourceSha256);
  assert.equal(document.reports.length, 1);
  const report = document.reports[0];
  assert.equal(report.id, child.id);
  reports.push(report);
  const events = await jsonLines(`results/${child.id}.events.jsonl`);
  const counts = count(events, 'kind');
  for (const [kind, total] of Object.entries(counts)) eventCounts[kind] = (eventCounts[kind] ?? 0) + total;
  for (const event of events.filter((entry) => entry.kind === 'fs-call')) fsMethods[event.method] = (fsMethods[event.method] ?? 0) + 1;
  const old = JSON.parse(await readFile(join(owned, 'evidence/results', `${child.id}.json`))).reports[0];
  history.push({ id: child.id, priorInitialRawStatus: old.semanticStatus, finalFreshRawStatus: report.semanticStatus, priorNativeStatus: old.nativeStatus, finalFreshNativeStatus: report.nativeStatus, finalEvidence: 'FRESH_SINGLE_FINAL40_RUN', originalEvidence: 'HISTORICAL_NOT_RERUN_NOT_REUSED_AS_FINAL' });
  for (const view of report.evidence.views ?? []) {
    const expected = expectations.find((entry) => entry.id === child.id).nativeExact[view.view];
    const fixture = fixtures.find((entry) => entry.id === child.id);
    const referenceIndex = native.observations.findIndex((entry) => entry.id === child.id && entry.view === view.view);
    const reference = native.observations[referenceIndex];
    assert.equal(reference.stdout, expected.stdout);
    assert.equal(reference.stderr, expected.stderr);
    assert.equal(reference.status, expected.status);
    const exact = expected.available && view.stdout === expected.stdout && view.stderr === expected.stderr && view.exitCode === expected.status;
    assert.equal(exact, view.nativeExact);
    viewRows.push({ id: child.id, view: view.view, fixture, referenceObservationIndex: referenceIndex + 1, expected, actual: { stdout: view.stdout, stderr: view.stderr, status: view.exitCode }, nativeExact: exact, semanticAccepted: view.semantic && view.exitCode === 0 && view.stderr === '', lane: view.view === 'brief-human' ? 'human-semantic-required-exact-characterization-only' : 'native-exact-machine', trace: view.trace, effects: 'Read-only virtual probe trace retained; original native fixture bytes/hash unchanged after run; no universal host isolation claim' });
    const oldView = old.evidence.views.find((entry) => entry.view === view.view);
    if (oldView.stdout !== view.stdout || oldView.stderr !== view.stderr || oldView.exitCode !== view.exitCode) priorDifferences.push({ id: child.id, view: view.view, old: { stdout: oldView.stdout, stderr: oldView.stderr, status: oldView.exitCode }, final: { stdout: view.stdout, stderr: view.stderr, status: view.exitCode }, classification: child.id === 'F16' ? 'SQLite MIME source delta; oracle unchanged' : 'other raw content delta' });
  }
  const moduleRows = await jsonLines(`results/${child.id}.modules.jsonl`);
  const caseLoaded = new Set();
  for (const entry of moduleRows) {
    if (entry.product && entry.resolved.startsWith('node:')) productBuiltins.add(entry.resolved);
    if (!entry.resolved.startsWith('file:')) continue;
    const location = fileURLToPath(entry.resolved);
    assert(location.startsWith(`${root}/`), location);
    const path = relative(root, location);
    const stat = await lstat(location);
    assert(stat.isFile() && !stat.isSymbolicLink(), path);
    assert.equal(stat.nlink, 1, path);
    caseLoaded.add(path);
    if (!loadedFiles.has(path)) {
      const bytes = await readFile(location);
      const sha256 = hash(bytes);
      if (path.startsWith('candidate/')) assert.equal(sha256, compiled.get(path), path);
      loadedFiles.set(path, { path, bytes: bytes.length, sha256, product: path.startsWith('candidate/') });
    }
  }
  if (['F33', 'F34'].includes(child.id)) {
    for (const kind of ['source-next', 'source-return', 'exact-caller-reason-verified', 'fs-abort-propagation-verified', 'late-read-rejection-injected', 'late-error-window-verified', 'cleanup-gates-released']) assert.equal(counts[`holdout-${kind}`], 1, `${child.id}/${kind}`);
    assert.equal(counts['holdout-late-return-rejection-injected'] ?? 0, Number(child.id === 'F34'));
    const window = events.find((entry) => entry.kind === 'holdout-late-error-window-verified');
    assert.equal(window.unhandledCount, 0);
    assert.equal(window.readInjected, true);
    assert.equal(window.returnInjected, child.id === 'F34');
    assert.equal(window.eventLoopTurns, 2);
    assert.equal(report.evidence.returned, 1);
    assert.equal(counts['unhandled-rejection'] ?? 0, 0);
    lifecycle.push({ id: child.id, fresh: true, nextCount: counts['holdout-source-next'], returnCount: report.evidence.returned, exactCallerReasonVerified: true, fsSignalAbortedExactReasonVerified: true, lateReadInjections: counts['holdout-late-read-rejection-injected'], lateReturnInjections: counts['holdout-late-return-rejection-injected'] ?? 0, observationWindow: window, cleanupGatesReleased: true, exactEvents: events.filter((entry) => entry.kind.startsWith('holdout-')), qualification: 'Genuine injected late rejection observed by unchanged assertions over two turns; not a proof of absence after arbitrary future host work. Invocation watchdog2000ms, child watchdog60000ms.' });
  }
  perCase.push({ id: child.id, eventCounts: counts, loadedFiles: [...caseLoaded].sort(), shellCalls: events.filter((entry) => entry.kind.startsWith('shell-')), fsCalls: events.filter((entry) => entry.kind === 'fs-call') });
  const adjudication = report.semanticStatus !== 'pass' ? report.semanticStatus : report.nativeStatus === 'native-profile-conflict' ? 'native-profile-conflict' : 'pass';
  outcomes.push({ id: child.id, definition: originalCases.find((entry) => entry.id === child.id), rawSemanticStatus: report.semanticStatus, rawNativeStatus: report.nativeStatus, adjudication, evidenceCohort: 'FRESH_FINAL40', rawReport: `results/${child.id}.json` });
}
assert.equal(reports.length, 40);
assert.equal(new Set(run.rows.map((row) => row.id)).size, 40);
const productFiles = [...loadedFiles.values()].filter((entry) => entry.product).sort((left, right) => left.path.localeCompare(right.path));
const staticClosure = await json('static-closure.json');
assert.deepEqual(productFiles.map((entry) => entry.path).sort(), staticClosure.files.map((entry) => `candidate/${entry.path}`).sort());
const nativeByView = {};
for (const row of viewRows) {
  const counts = nativeByView[row.view] ??= { total: 0, exact: 0, semanticAccepted: 0, unavailable: 0 };
  counts.total++;
  counts.exact += Number(row.nativeExact);
  counts.semanticAccepted += Number(row.semanticAccepted);
  counts.unavailable += Number(!row.expected.available);
}
const nativeInventory = native.observations.map((observation, index) => {
  const comparison = viewRows.find((entry) => entry.referenceObservationIndex === index + 1);
  return { referenceIndex: index + 1, observation, observationSha256: hash(JSON.stringify(observation)), finalComparison: comparison ? { id: comparison.id, view: comparison.view, nativeExact: comparison.nativeExact, semanticAccepted: comparison.semanticAccepted, lane: comparison.lane } : null, status: comparison ? 'REUSED_FROZEN_ORACLE_COMPARED_TO_FRESH_CONTENT_VIEW' : 'REFERENCE_RETAINED_NOT_COMPARED_NOT_A_PASS' };
});
const machineViews = viewRows.filter((row) => row.view !== 'brief-human');
const summary = { generatedAt: new Date().toISOString(), candidateCommit: freeze.commit, sourceSha256: freeze.sourceSha256, dependencySha256: freeze.dependencySha256, runnerSha256: binding.runnerSha256, peerReportSha256: binding.peerReportSha256, freshCases: reports.length, reusedCasesAsFinalEvidence: 0, run: { startedAt: run.startedAt, finishedAt: run.finishedAt, elapsedMs: run.elapsedMs, children: run.rows.length, completedChildren: run.rows.filter((row) => row.status === 0).length, timeouts: run.rows.filter((row) => row.signal).length, retries: run.retries, nativeCalls: 0, caseTimeoutMs: run.caseTimeoutMs, globalTimeoutMs: run.globalTimeoutMs, childOutputCapBytes: run.childOutputCapBytes }, rawSemanticCounts: count(reports, 'semanticStatus'), rawNativeCounts: count(reports, 'nativeStatus'), adjudicatedCounts: count(outcomes, 'adjudication'), rawFailureIds: reports.filter((row) => row.semanticStatus === 'fail').map((row) => row.id), routedFailureIds: run.routedFailureIds, nativeProfileConflictIds: reports.filter((row) => row.nativeStatus === 'native-profile-conflict').map((row) => row.id), backendCharacterizationIds: reports.filter((row) => row.semanticStatus === 'backend-limitation').map((row) => row.id), unsupported: reports.filter((row) => row.semanticStatus === 'unsupported').length, content: { views: viewRows.length, semanticAcceptedViews: viewRows.filter((row) => row.semanticAccepted).length, nativeByView, machineExact: { matched: machineViews.filter((row) => row.nativeExact).length, total: machineViews.length }, humanExactNotMandatory: { matched: nativeByView['brief-human'].exact, total: 20 }, historicalNativeReferencesRetained: nativeInventory.length, contentReferencesCompared: viewRows.length, remainingReferencesNotCompared: nativeInventory.filter((row) => !row.finalComparison).length }, eventCounts, fsMethods, loadedProductFiles: productFiles.length, loadedHarnessFiles: loadedFiles.size - productFiles.length, productClosureSha256: hash(productFiles.map((entry) => `${entry.path}\0${entry.sha256}\n`).join('')), productBuiltins: [...productBuiltins].sort(), buildAndScopedTypes: 'REUSED_READY_PASS_NOT_RERUN', standaloneConsumer: 'NOT_RUN_NOT_CLAIMED', validationBoundary: 'No full gate/default/public integration; original40 only; TEXT extreme-input safety has no additional behavioral cohort here; actual Shell source changed separately from file family', policyMetadataBoundary: 'Each raw report preserves original PREP candidateExecutions=0 metadata unchanged; fresh execution counts are this summary/run/events, not the historical PREP policy field.' };
await save('final-summary.json', summary);
await save('final-adjudication.json', outcomes);
await save('final-content-comparisons.json', viewRows);
await save('final-native-differences.json', viewRows.filter((row) => !row.nativeExact));
await save('final-native-reference-inventory.json', nativeInventory);
await save('final-lifecycle.json', lifecycle);
await save('final-loaded-closure.json', { productClosureSha256: summary.productClosureSha256, sourceSha256: freeze.sourceSha256, candidateCommit: freeze.commit, actualProductEntrypoints: ['candidate/dist/commands/file/index.js', 'candidate/dist/contracts/index.js', 'candidate/dist/shell/index.js'], productFiles, allLoadedFiles: [...loadedFiles.values()].sort((left, right) => left.path.localeCompare(right.path)), productBuiltins: summary.productBuiltins, perCase });
await save('final-history-comparison.json', { history, changedContentOutputs: priorDifferences, noHistoricalResultsRewritten: true, sourceDeltaReference: 'source-deltas.json plus sqlite-source.diff, text-source.diff and shell-source.diff from READY publication', classification: 'Observed F16 MIME change is distinct from corrected F29/F33/F34 predicates; F33/F34 final observations corroborate old3 source evidence. No isolated TEXT causality or unchanged Shell source claim.' });
console.log(JSON.stringify(summary, null, 2));
