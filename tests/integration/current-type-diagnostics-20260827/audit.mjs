import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const scope = dirname(fileURLToPath(import.meta.url));
const repository = resolve(scope, '../../..');
const output = join(scope, 'evidence', 'audit');
mkdirSync(output, { recursive: true });
const revision = '954406871fae381b1c69441b34946a224201d7ad';
const original = 'b494675c34dc289f4ad4b10a9201e1211eb0a7d8';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => {
  const result = spawnSync('git', args, { cwd: repository, maxBuffer: 16 * 1024 * 1024, timeout: 30000 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
};
const show = (commit, path) => git(['show', `${commit}:${path}`]);
const save = (name, value) => writeFileSync(join(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const reportRoot = 'tests/integration/full-gate-20260827/combined-b494675c';
const evidenceManifest = JSON.parse(show(revision, `${reportRoot}/EVIDENCE_MANIFEST.json`));
function capture(key) {
  const entry = evidenceManifest.captures.find(entry => entry.key === key);
  assert.ok(entry, key);
  const stored = show(revision, `${reportRoot}/${entry.path}`);
  assert.equal(hash(stored), entry.storedSha256);
  const decoded = entry.encoding === 'identity' ? stored : gunzipSync(Buffer.from(stored.toString().trim(), 'base64'));
  assert.equal(hash(decoded), entry.originalSha256);
  assert.equal(decoded.length, entry.originalBytes);
  return decoded;
}
const parseDiagnostics = bytes => [...bytes.toString().matchAll(/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/gm)].map(match => ({ path: match[1], line: Number(match[2]), column: Number(match[3]), code: match[4], message: match[5] }));
const oldCold = parseDiagnostics(capture('canonical/typecheck.stdout.log'));
const oldWarm = parseDiagnostics(capture('focused-v2/global-types-after-build.stdout.log'));
const classify = path => path.endsWith('/file/text-bound.test.ts') ? 'current-test-type-annotation' : path.includes('/tree/sealed/inputs/') ? 'sealed-flattened-source-data' : path.includes('/atomic-webdav-profile') ? 'public-consumer-build-order' : path === 'tests/shell-stress/env-split-consumer/packed-public-types.ts' ? 'new-env-S-public-consumer-build-order' : 'unclassified';
const aggregate = values => Object.fromEntries([...new Set(values)].sort().map(value => [value, values.filter(entry => entry === value).length]));
const cohorts = {};
for (const [label, commit] of [['b494-v3', original], ['current', revision]]) {
  const read = name => JSON.parse(readFileSync(join(scope, 'evidence', label, name)));
  const cold = read('cold-typecheck.json');
  const warm = read('warm-typecheck.json');
  const build = read('build.json');
  assert.equal(build.status, 0);
  assert.equal(cold.status, 2);
  assert.equal(warm.status, 2);
  const added = cold.diagnostics.filter(entry => !oldCold.some(other => JSON.stringify(other) === JSON.stringify(entry)));
  const removed = oldCold.filter(entry => !cold.diagnostics.some(other => JSON.stringify(other) === JSON.stringify(entry)));
  assert.deepEqual(removed, [], label);
  if (label === 'b494-v3') assert.deepEqual(added, []);
  else {
    assert.equal(added.length, 5);
    assert.ok(added.every(entry => classify(entry.path) === 'new-env-S-public-consumer-build-order'));
  }
  assert.deepEqual(warm.diagnostics, oldWarm, label);
  const paths = [...new Set(cold.diagnostics.map(entry => entry.path))];
  cohorts[label] = {
    revision: commit,
    cold: { count: cold.diagnostics.length, codes: aggregate(cold.diagnostics.map(entry => entry.code)), categories: aggregate(cold.diagnostics.map(entry => classify(entry.path))) },
    warm: { count: warm.diagnostics.length, codes: aggregate(warm.diagnostics.map(entry => entry.code)), categories: aggregate(warm.diagnostics.map(entry => classify(entry.path))) },
    originalColdAndWarmRowsRetained: true,
    coldAddedSinceRetainedOriginal: added,
    coldRemovedSinceRetainedOriginal: removed,
    paths: paths.map(path => ({ path, sha256: hash(show(commit, path)), classification: classify(path), cold: cold.diagnostics.filter(entry => entry.path === path), warm: warm.diagnostics.filter(entry => entry.path === path) })),
    productionDiagnostics: cold.diagnostics.filter(entry => entry.path.startsWith('src/')),
    envSplitDiagnostics: cold.diagnostics.filter(entry => /env-split|env-split-validity/.test(entry.path)),
  };
}
assert.ok(Object.values(cohorts).every(cohort => !cohort.cold.categories.unclassified));
save('diagnostics.json', { originalReportRevision: revision, cohorts, originalCold: oldCold, originalWarm: oldWarm, productAndConfigDelta: git(['diff', '--name-status', original, revision, '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']).toString() });

const routing = JSON.parse(show(revision, `${reportRoot}/FAILURE_ROUTING.json`));
const rawTap = capture('canonical/test.stdout.log').toString();
const failures = routing.failures.filter(row => row.group === 'historical-diagnostic-pin' || row.group === 'historical-cleanup-pin');
assert.equal(failures.length, 99);
for (const row of failures) {
  assert.equal(row.failureType, 'hookFailed');
  assert.ok(rawTap.includes(row.detail), `Routing must match authenticated raw TAP: ${row.id}`);
}
const audits = {};
for (const commit of [original, revision]) {
  const baselinePath = 'benchmarks/shell-stress/diagnostic-profiles/native-baseline.json';
  const baseline = JSON.parse(show(commit, baselinePath));
  const diagnosticPins = Object.entries(baseline.sources).filter(([path]) => path.startsWith('tests/')).map(([path, expected]) => ({ path, expected, actual: hash(show(commit, path)) }));
  const cleanupPath = 'tests/shell/invocation-cleanup-public.test.ts';
  const cleanupText = show(commit, cleanupPath).toString();
  const pinBlock = cleanupText.slice(cleanupText.indexOf('const frozenHashes'), cleanupText.indexOf('let snapshot'));
  const cleanupPins = [...pinBlock.matchAll(/"([^"]+)": "([a-f0-9]{64})"/g)].map(([, path, expected]) => ({ path, expected, actual: hash(show(commit, path)), archivedRuntimeActual: hash(show('4c16d9c5a0e8661bc326a754205559a3e7ea6a32', path)) }));
  for (const pin of cleanupPins) assert.equal(pin.archivedRuntimeActual, pin.expected, pin.path);
  const changedDiagnosticPins = diagnosticPins.filter(pin => pin.actual !== pin.expected);
  const changedCleanupPins = cleanupPins.filter(pin => pin.actual !== pin.expected);
  assert.equal(changedDiagnosticPins.length, 2);
  assert.equal(changedCleanupPins.length, 1);
  for (const pin of changedDiagnosticPins) {
    assert.equal(hash(show('4fa20ac6^', pin.path)), pin.expected);
    assert.equal(hash(show('4fa20ac6', pin.path)), pin.actual);
  }
  assert.equal(hash(show('1b133a86^', changedCleanupPins[0].path)), changedCleanupPins[0].expected);
  assert.equal(hash(show('1b133a86', changedCleanupPins[0].path)), changedCleanupPins[0].actual);
  for (const row of failures) {
    const first = row.group === 'historical-diagnostic-pin' ? changedDiagnosticPins[0] : changedCleanupPins[0];
    assert.ok(row.detail.includes(`actual: '${first.actual}'`), row.id);
    assert.ok(row.detail.includes(`expected: '${first.expected}'`), row.id);
  }
  audits[commit] = { baselinePath, baselineSha256: hash(show(commit, baselinePath)), diagnosticPins, cleanupPins, changedDiagnosticPins, changedCleanupPins, rawFailureActualEqualsCommittedPreExecutionBlob: true };
}
const gateReport = JSON.parse(capture('canonical/report.json'));
save('hash-guards.json', {
  method: 'Read authenticated retained TAP and Git blobs; no native/test bodies or writer reproductions executed.',
  counts: aggregate(failures.map(row => row.group)),
  files: aggregate(failures.map(row => row.file)),
  failedRows: failures.map(({ id, file, name, group, failureType, rawCapture }) => ({ id, file, name, group, failureType, rawCapture })),
  audits,
  conclusion: 'All 99 retained hook failures are stale live-source/helper binders already unsatisfied in the committed pre-run tree. Zero of these 99 require execution-time mutation to explain their actual hashes. They remain failures, not passing body assertions.',
  separateTrackedArtifactMutation: { source: 'Authenticated original canonical/report.json only; no writer investigation repeated', message: gateReport.error.message, status: gateReport.status, excludedFrom99RootCause: true },
});
for (const [name, args] of [
  ['diagnostic-pin-migration.diff', ['diff', '4fa20ac6^', '4fa20ac6', '--', 'tests/shell-stress/differential.test.ts', 'tests/shell-stress/current-gaps/compatibility.test.ts']],
  ['cleanup-pin-source-change.diff', ['diff', '1b133a86^', '1b133a86', '--', 'src/shell/shell.ts']],
]) writeFileSync(join(output, name), git(args), { flag: 'wx' });
const treeBase = 'tests/commands/filesystem-inspection-stress/tree/sealed';
const provenance = JSON.parse(show(original, `${treeBase}/provenance.json`));
const inventory = JSON.parse(show(original, `${treeBase}/inventory.json`));
const historicalInputs = inventory.filter(entry => entry.path.startsWith('inputs/') && entry.path.endsWith('.ts')).map(entry => {
  const bytes = show(original, `${treeBase}/${entry.path}`);
  assert.equal(hash(bytes), entry.sha256);
  const originalPath = entry.path.slice('inputs/'.length).replaceAll('__', '/');
  assert.equal(provenance.inputs.find(input => input.path === originalPath)?.sha256, entry.sha256);
  assert.equal(hash(show(revision, `${treeBase}/${entry.path}`)), entry.sha256);
  return { ...entry, originalPath, preservedBothCandidates: true };
});
assert.equal(historicalInputs.length, 6);
save('historical-inputs.json', { baseline: original, current: revision, provenancePath: `${treeBase}/provenance.json`, inventoryPath: `${treeBase}/inventory.json`, historicalInputs, classification: 'Six sealed historical contract-source captures flattened into data filenames; not current product source, not canonical runtime tests, not new env-S fixtures. Seven unresolved relative imports plus one cascade arise in five files; errors.ts contributes no diagnostic.' });
save('PROVENANCE.json', { createdAt: new Date().toISOString(), auditRunnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))), candidates: { original, current: revision }, retainedManifestSha256: hash(show(revision, `${reportRoot}/EVIDENCE_MANIFEST.json`)), retainedRoutingSha256: hash(show(revision, `${reportRoot}/FAILURE_ROUTING.json`)), noTestsExecuted: true, noSourceConfigChanges: true });
console.log(JSON.stringify({ diagnosticCohorts: Object.fromEntries(Object.entries(cohorts).map(([name, cohort]) => [name, { cold: cohort.cold.count, warm: cohort.warm.count }])), historicalGuardFailures: failures.length, historicalDataInputs: historicalInputs.length }));
