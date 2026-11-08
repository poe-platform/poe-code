import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { artifact, digest, directory, snapshot } from './common.mjs';
import { git } from '../jq-42-independent-review/common.mjs';
import { manifest, preservation, prefix } from './preservation.mjs';

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url)));
const before = snapshot();
const evidenceOnlyCommit = '95966ca';
const applications = ['native', 'host'].map(group => read(`${group}-application.json`));
for (const application of applications) {
  const paths = git(['diff-tree', '--no-commit-id', '--name-only', '-r', application.commit]).toString().trim().split('\n').sort();
  assert.deepEqual(paths, [...application.paths].sort());
  for (const path of paths) {
    const file = manifest.files.find(file => file.path === path);
    assert.equal(digest(git(['show', `${application.commit}:${path}`])), file.afterSha256);
  }
}
for (const phase of ['pre', 'post']) for (const mode of ['source', 'compiled']) {
  const cohort = read(`${phase}-${mode}-cohorts.json`);
  assert.equal(cohort.stableProduct, true);
  assert.equal(cohort.stableTooling, true);
  assert.equal(cohort.results.length, 1344);
  assert.ok(cohort.results.every(row => row.pass));
  if (phase === 'post') assert.deepEqual(cohort.vectors, read(`pre-${mode}-cohorts.json`).vectors);
  if (mode === 'compiled') {
    assert.equal(cohort.build.emittedFiles, 520);
    assert.equal(cohort.build.loaded.length, 130);
    assert.equal(cohort.build.diagnostics, '');
  }
}
const counts = {};
for (const name of readdirSync(directory).filter(name => /^(pre|post)-.*\.json$/u.test(name))) {
  const record = read(name);
  if (!record.command) continue;
  assert.equal(record.signal, null);
  assert.equal(record.error, undefined);
  assert.equal(record.before.structuredSha256, record.after.structuredSha256);
  assert.deepEqual(record.before.tooling, record.after.tooling);
  if (record.counts?.tests !== undefined) {
    assert.equal(record.counts.skipped, 0);
    assert.equal(record.counts.cancelled, 0);
    assert.equal(record.counts.todo, 0);
    counts[name] = record.counts;
  }
}
const historicalName = 'all original author and independent evidence paths remain unchanged';
for (const [name, total, passes] of [['post-changed-canonical', 427, 427], ['post-full-structured', 3758, 3757], ['post-broad-unchanged', 1580, 1579]]) {
  const record = read(`${name}.json`);
  assert.equal(record.counts.tests, total);
  assert.equal(record.counts.pass, passes);
  const failures = [...record.stdout.matchAll(/^not ok \d+ - (.+)$/gmu)].map(match => match[1]);
  assert.deepEqual(failures, total === passes ? [] : [historicalName]);
  if (failures.length) {
    const helper = manifest.files.find(file => file.path === `${prefix}harness.ts`);
    assert.ok(record.stdout.includes(helper.beforeSha256));
    assert.ok(record.stdout.includes(helper.afterSha256));
  }
}
const oldSealPath = `${prefix}jq-42-review-fixes/immutable-before.json`;
const oldSeal = JSON.parse(readFileSync(oldSealPath));
const oldSealDeltas = [];
for (const [path, oldHash] of Object.entries(oldSeal.files)) {
  const actual = digest(readFileSync(path));
  if (actual === oldHash) continue;
  const allowed = manifest.files.find(file => file.path === path);
  assert.ok(allowed, path);
  assert.equal(oldHash, allowed.beforeSha256);
  assert.equal(actual, allowed.afterSha256);
  assert.equal(digest(readFileSync(allowed.beforeSnapshot)), oldHash);
  oldSealDeltas.push({ path, oldHash, actual });
}
for (const name of ['post-author-new', 'post-scoped-types', 'post-author-scoped-types', 'post-canonical-scoped-types', 'post-global-types']) assert.equal(read(`${name}.json`).status, 0);
const preserved = preservation('post');
const reruns = ['source', 'compiled'].map(mode => {
  const record = read(`post-rerun-${mode}-cohorts.json`);
  assert.equal(record.results.length, 1344);
  assert.ok(record.results.every(row => row.pass));
  assert.deepEqual(record.vectors, read(`pre-${mode}-cohorts.json`).vectors);
  return { mode, summary: record.summary, stableProduct: record.stableProduct, stableTooling: record.stableTooling,
    beforeProduct: record.before.productSha256, afterProduct: record.after.productSha256,
    changedSource: Object.keys(record.before.files).filter(path => record.before.files[path] !== record.after.files[path]),
    buildDerivedOutputStable: record.build?.derivedOutputStable };
});
assert.equal(read('final-canonical-scoped-types.json').status, 0);
const finalGlobal = read('final-global-types.json');
assert.equal(finalGlobal.status, 2);
assert.match(finalGlobal.stdout, /tests\/shell\/env-replacement-bounds\.test\.ts\(7,173\): error TS2769/u);
assert.match(finalGlobal.stdout, /tests\/shell\/env-replacement\.test\.ts\(119,89\): error TS2339/u);
const legacyPath = `${prefix}jq-42-independent-final/r2-legacy.json`;
assert.deepEqual(readFileSync(legacyPath), git(['show', `bb1ceabe:${legacyPath}`]));
const legacy = JSON.parse(readFileSync(legacyPath));
assert.deepEqual(legacy.summary.legacy, { exact: 45, diagnosticOnly: 43, statusOrStdout: 6, routeTransportAgreement: true });
const formerlyFailing = [...new Set(legacy.results.filter(row => !row.pass).map(row => row.id))];
assert.equal(formerlyFailing.length, 49);
for (const mode of ['source', 'compiled']) {
  const rows = read(`post-${mode}-cohorts.json`).results.filter(row => row.cohort === 'legacy');
  for (const original of legacy.results) {
    const observed = rows.find(row => row.id === original.id && row.route === original.route && row.transport === original.transport);
    assert.ok(observed);
    assert.equal(observed.pass, true);
    assert.deepEqual(observed.expected, original.expected);
  }
}
artifact('final-audit.json', { at: new Date().toISOString(), before, after: snapshot(), evidenceOnlyCommit,
  applicationCommits: applications.map(application => ({ commit: application.commit, paths: application.paths })), counts,
  preservation: preserved, frozenVectorsIdentical: true, prePostCohorts: '1344/1344 in each of four runs; each compiled build 520 outputs and130 emitted runtime modules; no dist writes',
  oldSeal: { path: oldSealPath, sha256: digest(readFileSync(oldSealPath)), files: Object.keys(oldSeal.files).length, exactApprovedDeltas: oldSealDeltas,
    disposition: 'Historical verifier intentionally unmodified. Complete suites retain its one live-before-hash failure; new preservation check verifies originals plus exact approved after bytes. No product regression or blanket fixture waiver.' },
  legacyClosure: { historicalCommit: 'bb1ceabe', baseline: legacy.summary.legacy, formerlyFailing, nowExact: 'All49 and all94 retain original expected tuples; 376/376 source and compiled on stable post phases.' },
  oneBoundedRerun: reruns, finalGlobal: { status: finalGlobal.status, stdout: finalGlobal.stdout, stderr: finalGlobal.stderr },
  limits: 'No skips. One bounded paired drift rerun: source stable, compiled product moved in shell files despite1344 exact passes; no further retry. Final global typing blocked by two unowned shell-test errors, not a source acceptance or clean-HEAD/full-product claim. Final reviewer writes only its subtree; exact canonical13 committed separately after evidence-only approval.' });
console.log('Final audit recorded exact13 deltas and unchanged vectors; historical seal, final global errors and unstable final compiled phase explicitly retained');
