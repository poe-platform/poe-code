import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { authenticateSourceTests, inventory } from './integrity.mjs';
import { addEvidence, git, json, owned, root, sha256, verifyFrozen } from './replay/review.mjs';

assert.equal(process.argv[2], 'capture-and-cleanup');
const read = path => JSON.parse(readFileSync(`${owned}/${path}`));
const before = read('before.json');
const report = { startedAt: new Date().toISOString(), candidate: before.candidate, stages: [], protected: verifyFrozen(), cleanup: [], limits: 'Complete source/test and installed inventories check added entries; not an append-proof entire extracted archive or live repository claim.' };
const preparationPath = 'tests/commands/expr-stress/diagnostics-review';
assert.deepEqual(inventory(preparationPath), before.preparationFiles);
report.preparationEntireTreeUnchangedIncludingAddedEntries = true;
const bindings = read('../bindings.json');
for (const binding of bindings.bindings) {
  assert.equal(sha256(readFileSync(binding.destination)), binding.boundSha256);
  const separator = binding.original.indexOf(':');
  assert.equal(sha256(git('show', binding.original)), binding.originalSha256);
  if (binding.destination.includes('/freeze/')) assert.deepEqual(readFileSync(binding.destination), git('show', `d0fb3ef0bc9c3c04cae829a47454c10e565ad971:${binding.original.slice(separator + 1)}`));
}
assert.deepEqual(inventory(`${owned}/../freeze`).map(entry => entry.path).sort(), bindings.bindings.filter(entry => entry.destination.includes('/freeze/')).map(entry => entry.destination.split('/freeze/')[1]).sort());
report.boundHelpersAndIndependentFreezeUnchanged = true;
const historical = 'tests/commands/expr-stress/extension-review/after-abort-fix';
const historicalFiles = inventory(historical);
const historicalNames = git('ls-tree', '-r', '-z', '--name-only', '50b1e560', '--', historical).toString().split('\0').filter(Boolean);
assert.deepEqual(historicalFiles.map(entry => `${historical}/${entry.path}`).sort(), historicalNames.sort());
for (const path of historicalNames) assert.deepEqual(readFileSync(path), git('show', `50b1e560:${path}`));
report.fixedPreviousEntireTree = { commit: git('rev-parse', '50b1e560^{commit}').toString().trim(), count: historicalFiles.length, digest: sha256(json(historicalFiles)), addedEntriesChecked: true };
const dependencies = read('devdeps-authentication.json');
for (const tree of dependencies.currentToolTrees) assert.deepEqual(inventory(join(root, 'node_modules', tree.path)).map(({ path, sha256 }) => ({ path, sha256 })), tree.files);
report.developmentDependencyTreesUnchangedIncludingAddedEntries = true;
const native = read('native-current/native-replay.json');
for (const identity of native.identities) assert.equal(sha256(readFileSync(identity.path)), identity.sha256);
report.qualifiedNativePrerequisitesUnchanged = true;
const candidateStage = read('candidate-diagnostics/stage.json');
const authorSource = candidateStage.sourceFiles.map(entry => ({ ...entry, path: `src/${entry.path}` }));
assert.deepEqual(authorSource, before.authorSeal.sources.candidate);
assert.equal(sha256(json(authorSource)), before.authorSeal.sourceInventorySha256);
report.authorSourceInventoryMatched = { count: authorSource.length, sha256: sha256(json(authorSource)), sourceTreeGitId: candidateStage.sourceTreeGitId };
const legacyPlan = read('legacy-plan.json');
for (const identity of legacyPlan.identities) assert.equal(sha256(readFileSync(join(candidateStage.source, identity.path))), identity.candidate);
report.sharedLegacyOriginalHashesMatched = legacyPlan.identities.length;
const stages = ['candidate-diagnostics', 'baseline-8f19a9d5'].map(label => ({ label, ...read(`${label}/stage.json`) }));
for (const stage of stages) {
  const sourceTests = authenticateSourceTests(stage);
  assert.deepEqual(sourceTests, read(`${stage.label}/source-tests-before.json`).files);
  const installed = inventory(stage.installed).map(({ path, sha256 }) => ({ path, sha256 }));
  assert.deepEqual(installed, stage.installedFiles);
  assert.equal(sha256(readFileSync(join(stage.sourceRoot, 'candidate.tar'))), stage.archiveSha256);
  assert.equal(sha256(readFileSync(join(stage.sourceRoot, stage.pack.filename))), stage.packageSha256);
  for (const input of stage.buildInputs) assert.equal(sha256(readFileSync(join(stage.source, input.path))), input.sha256);
  const manifest = { label: stage.label, commit: stage.commit, sourceTests, sourceTestsDigest: sha256(json(sourceTests)), installedFiles: installed, installedDigest: sha256(json(installed)), archiveSha256: stage.archiveSha256, packageSha256: stage.packageSha256, sourceAndTestAddedEntriesChecked: true, installedAddedEntriesChecked: true };
  addEvidence(`${owned}/final-inventory-${stage.label}.json`, manifest);
  report.stages.push({ ...manifest, sourceTests: sourceTests.length, installedFiles: installed.length });
}
const acceptance = read('acceptance-diagnostics/summary.json');
const independent = read('independent-first/independent.json');
const controls = read('core-controls/controls.json');
const supplement = read('supplement-diagnostics/controls.json');
const nullable = read('supplement-diagnostics/nullable-separate-cohort.json');
const historicalNullable = JSON.parse(git('show', `50b1e560:${historical}/replay/supplement-27a77935/nullable-separate-cohort.json`));
assert.deepEqual(nullable.rows.map(({ id, argv, expected }) => ({ id, argv, expected })), historicalNullable.rows.map(({ id, argv, expected }) => ({ id, argv, expected })));
function testSummary(path) {
  const result = read(path);
  const counts = Object.fromEntries([...result.stdout.matchAll(/ℹ (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)/g)].map(match => [match[1], Number(match[2])]));
  return { path, command: [result.binary, ...result.args], cwd: result.cwd, status: result.status, signal: result.signal, failure: result.failure, counts, workerReceipts: result.stdout.split('\n').filter(line => line.startsWith('{') && /[Ww]orker/.test(line)).map(line => JSON.parse(line)) };
}
function safety(entries) {
  return {
    jobs: entries.length,
    returned: entries.filter(entry => entry.outer.state === 'returned').length,
    outerTerminationAwaited: entries.filter(entry => entry.outer.terminationAwaited).length,
    preSafetyMeasured: entries.filter(entry => entry.value?.activeBeforeSafetyCleanup !== undefined).length,
    preSafetyNonzero: entries.filter(entry => entry.value?.activeBeforeSafetyCleanup > 0).map(entry => entry.id),
    liveWorkersMeasured: entries.filter(entry => entry.value?.liveWorkers !== undefined).length,
    liveWorkersNonzero: entries.filter(entry => entry.value?.liveWorkers > 0).map(entry => entry.id),
    workerStartEvents: entries.reduce((total, entry) => total + (entry.value?.events ?? []).filter(event => event.type === 'workerStart' || event === 'workerStart').length, 0),
    eventsQualification: 'Worker-start events may include deterministic synthetic transport workers. liveWorkers in lifecycle helpers is measured after their finally cleanup, not necessarily before safety; no upgraded pre-safety claim.',
  };
}
const traces = read('acceptance-diagnostics/runtime-traces.json');
const safetyCounts = {
  nativeTupleProbes: safety(traces.traces.map(entry => ({ id: entry.id, outer: entry.outer, value: entry }))),
  independentNativeInputs: safety(independent.rows.map(entry => ({ id: entry.id, outer: entry.outer, value: entry.outer.value?.value }))),
  independentRuntime: safety(independent.controls.map(entry => ({ id: entry.id, outer: entry.outer, value: entry.actual }))),
  core: safety(controls.rows.map(entry => ({ id: entry.id, outer: entry, value: entry.value }))),
  supplemental: safety(supplement.rows.map(entry => ({ id: entry.id, outer: entry.outer, value: entry.outer.value?.value }))),
};
for (const group of Object.values(safetyCounts)) {
  assert.equal(group.outerTerminationAwaited, group.jobs);
  assert.deepEqual(group.preSafetyNonzero, []);
  assert.deepEqual(group.liveWorkersNonzero, []);
}
const summary = {
  candidate: before.candidate, startedAt: before.startedAt, measuredThrough: new Date().toISOString(),
  source: report.authorSourceInventoryMatched, sourceTests: report.stages[0].sourceTests, sourceTestsDigest: report.stages[0].sourceTestsDigest,
  distribution: { build: candidateStage.commands.map(({ binary, args, status, failure }) => ({ binary, args, status, failure })), strictInstalledDeclarations: read('distribution-diagnostics/declaration-check.json').status, plainNodePhysicalModule: read('distribution-diagnostics/plain-node.json').status },
  nativeQualification: native.cohorts.map(cohort => ({ id: cohort.id, profiles: cohort.profiles.map(({ id, denominator, strictMatches }) => ({ id, denominator, strictMatches })) })),
  fullFrozenCandidate: acceptance.summaries,
  independent: independent.summary,
  independentFailedInputs: independent.rows.filter(entry => !entry.comparison.strict).map(({ id, argv, expected, actual, comparison, classification }) => ({ id, argv, expected, actual, comparison, classification })),
  independentFailedControls: independent.controls.filter(entry => !entry.passed).map(({ id, input, actual }) => ({ id, input, actual: { status: actual.status, stdoutBase64: actual.stdoutBase64, stderrBase64: actual.stderrBase64 } })),
  core: { count: controls.subcaseCount, failed: controls.failedSubcases },
  supplemental: { count: supplement.rows.length, failed: supplement.failed, nullableStrict: nullable.rows.filter(entry => entry.comparison.strict).length, nullableTotal: nullable.rows.length, nullableFailures: nullable.rows.filter(entry => !entry.comparison.strict).map(entry => entry.id), historicalNullableInputsAndNativeTuplesUnchanged: true },
  regressions: ['shared-legacy276', 'author-diagnostics71', 'expr-legacy241', 'expr-legacy241-qualified'].map(name => testSummary(`regressions/${name}.json`)),
  optionalNative: { path: 'frozen-comparators/opt-in-native-regressions.json', summary: read('frozen-comparators/opt-in-native-regressions.json').stdout.split('\n').filter(line => /^# (tests|pass|fail|cancelled|skipped|todo)/.test(line)) },
  safetyCounts,
  limitations: ['No source repair or golden normalization.', 'Full frozen cohorts retain ten GNU locale mismatches; Apple is separate.', 'AST-first counterexample is one failed independent holdout, never one of requested nine.', 'Frozen output-one profile remains failed, not rebaselined.', 'Author71 and expr241 overlap prior/native/control coverage; no unique-test summation.', 'Native profiling is GNU9.7 on Darwin, not Linux.', 'No root expr integration, public expr subpath, full gate, duration target, superiority or completion claim.'],
};
addEvidence(`${owned}/summary.json`, summary);
const processResult = spawnSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' });
assert.equal(processResult.status, 0);
const processes = processResult.stdout.trim().split('\n').map(line => {
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
  return { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] };
});
const ancestors = new Set([process.pid]);
let current = process.pid;
while (current > 1) { current = processes.find(entry => entry.pid === current)?.ppid ?? 0; ancestors.add(current); }
const needles = [owned.replace(/\/replay$/, ''), ...stages.flatMap(stage => [stage.sourceRoot, stage.destinationRoot])];
const related = processes.filter(entry => !ancestors.has(entry.pid) && needles.some(needle => entry.command.includes(needle)));
report.preSafetyQuiescence = { measuredAt: new Date().toISOString(), ownedRelatedProcesses: related, harnessAncestorsExcluded: [...ancestors], method: 'All launched commands settled; all outer watchdog termination awaited; exact owned-path process snapshot. Not a global process census or proof about uninstrumented host internals.' };
assert.deepEqual(related, []);
addEvidence(`${owned}/pre-cleanup.json`, report);
for (const stage of stages) for (const path of [stage.sourceRoot, stage.destinationRoot]) {
  assert(resolve(path).startsWith(`${resolve(tmpdir())}/expr-final-`));
  assert(path !== root && !root.startsWith(`${path}/`));
  rmSync(path, { recursive: true });
  report.cleanup.push({ path, removed: !existsSync(path), ownedStage: stage.label });
}
report.gitStatus = git('status', '--short').toString();
report.completedAt = new Date().toISOString();
addEvidence(`${owned}/final-integrity-cleanup.json`, report);
console.log(json({ stages: report.stages.map(({ label, sourceTests, installedFiles }) => ({ label, sourceTests, installedFiles })), safetyCounts, cleanup: report.cleanup }));
