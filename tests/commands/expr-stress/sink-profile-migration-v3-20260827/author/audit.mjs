import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { owned, root, hash, git, inventory, manifest, verifyInputs } from './integrity-v2.mjs';

const label = process.argv[2];
assert(/^[a-z0-9-]+$/u.test(label ?? ''), 'supply the explicit capture label to audit');
assert(process.argv.length <= 4 && (!process.argv[3] || process.argv[3] === '--capture'));
const output = join(owned, label);
const load = name => JSON.parse(readFileSync(join(output, name)));
const checks = [];
function check(name, callback) { callback(); checks.push(name); }
const inputs = verifyInputs();
const summary = load('SUMMARY.json');
const candidate = load('candidate.json');
check('exact c3 product, c25 ancestry and canonical-only commit', () => {
  assert.equal(candidate.candidate, manifest.candidate);
  assert.equal(candidate.canonicalCommit, manifest.canonicalCommit);
  git('merge-base', '--is-ancestor', manifest.quotaAncestor, manifest.candidate);
  assert.equal(git('diff-tree', '--no-commit-id', '--name-only', '-r', manifest.canonicalCommit).toString().trim(), 'tests/commands/expr/contracts.test.ts');
});
check('all four final cohorts retain original denominators and distinct results', () => {
  for (const [cohort, total] of [['canonical', 237], ['core', 146], ['nearby', 16], ['quota', 47]]) {
    assert.equal(summary.separateNewReruns.original[cohort].tests, total);
    assert.equal(summary.separateNewReruns.original[cohort].pass, total - 1);
    assert.equal(summary.separateNewReruns.revised[cohort].tests, total);
    assert.equal(summary.separateNewReruns.revised[cohort].pass, total);
  }
  for (const profile of ['original', 'revised']) {
    for (const cohort of ['canonical', 'focused']) for (const name of ['cancelled', 'skipped', 'todo']) assert.equal(summary.separateNewReruns[profile][cohort][name], 0);
    assert.equal(summary.separateNewReruns[profile].focused.tests, 27);
  }
});
const nearby = Object.fromEntries(['original', 'revised'].map(profile => [profile, load(`${profile}-nearby-results.json`)]));
const quota = Object.fromEntries(['original', 'revised'].map(profile => [profile, load(`${profile}-quota-results.json`)]));
const core = Object.fromEntries(['original', 'revised'].map(profile => [profile, load(`${profile}-core/core-controls.json`)]));
check('only nearby target expectation changed; all other tuple fields and driver bytes retained', () => {
  const original = JSON.parse(readFileSync(join(owned, 'original/nearby/controls.json')));
  const revised = JSON.parse(readFileSync(join(owned, 'revised/nearby/controls.json')));
  const changed = [];
  for (let index = 0; index < original.controls.length; index++) {
    const { expected: before, ...oldInput } = original.controls[index];
    const { expected: after, ...newInput } = revised.controls[index];
    assert.deepEqual(newInput, oldInput);
    if (JSON.stringify(before) !== JSON.stringify(after)) changed.push(oldInput.id);
  }
  assert.deepEqual(changed, ['stdout-failure-no-regex-replay']);
});
check('only quota target expectation changed; cap two, mode, job count and all inputs preserved', () => {
  assert.equal(quota.original.rows.length, quota.revised.rows.length);
  const changed = [];
  for (let index = 0; index < quota.original.rows.length; index++) {
    const { expected: before, ...oldInput } = quota.original.rows[index].input;
    const { expected: after, ...newInput } = quota.revised.rows[index].input;
    assert.deepEqual(newInput, oldInput);
    if (JSON.stringify(before) !== JSON.stringify(after)) changed.push(oldInput.id);
  }
  assert.deepEqual(changed, ['stdout-rejection-normal-quota']);
  const specimen = quota.revised.rows.find(row => row.input.id === changed[0]);
  assert.equal(specimen.input.cap, 2);
  assert.deepEqual(specimen.input.argv, ['1']);
  assert.equal(specimen.input.mode, 'reject-stdout');
  assert.equal(specimen.input.expected.jobs, 0);
});
const oldNearby = nearby.original.cases.find(row => row.id === 'stdout-failure-no-regex-replay');
const newNearby = nearby.revised.cases.find(row => row.id === 'stdout-failure-no-regex-replay');
check('nearby actual identity, ordered one-job descriptor, budgets, callbacks and cleanup unchanged', () => {
  for (const key of ['observed', 'jobs', 'encodes', 'budgetCount', 'sessionCount', 'events']) assert.deepEqual(newNearby[key], oldNearby[key], key);
  assert.deepEqual(newNearby.args, ['a', ':', 'a']);
  assert.equal(newNearby.observed.rejected, 'sink');
  assert.equal(newNearby.observed.stdout, '');
  assert.equal(newNearby.observed.stderr, '');
  assert.equal(newNearby.jobs.length, 1);
  assert.equal(newNearby.budgetCount, 1);
  assert.equal(newNearby.sessionCount, 1);
  assert.equal(newNearby.events.filter(event => event.kind === 'stdout-start').length, 1);
  assert.equal(newNearby.events.filter(event => event.kind.startsWith('stderr')).length, 0);
  assert.equal(newNearby.events.filter(event => event.kind === 'close-end').length, 1);
  assert(newNearby.events.filter(event => Object.hasOwn(event, 'activeWorkers')).every(event => event.activeWorkers === 0));
});
const oldQuota = quota.original.rows.find(row => row.input.id === 'stdout-rejection-normal-quota');
const newQuota = quota.revised.rows.find(row => row.input.id === 'stdout-rejection-normal-quota');
check('quota direct original-reason identity assertion passes without any diagnostic attempt', () => {
  for (const key of ['events', 'jobs', 'attempts', 'actual', 'activeAtSettlement', 'activeAfterCleanup']) assert.deepEqual(newQuota[key], oldQuota[key], key);
  assert.equal(newQuota.checks.find(row => row.name === 'identical stdout rejection without diagnostic attempt')?.passed, true);
  assert.equal(newQuota.actual.rejection, 'sink');
  assert.deepEqual(newQuota.attempts.map(attempt => attempt.channel), ['stdout']);
  assert.equal(newQuota.attempts[0].bytes, 2);
  assert.equal(newQuota.attempts[0].hex, '310a');
  assert.equal(newQuota.jobs.length, 0);
  assert.equal(newQuota.activeAtSettlement, 0);
  assert.equal(newQuota.activeAfterCleanup, 0);
  const originalNames = oldQuota.checks.map(row => row.name);
  assert.deepEqual(newQuota.checks.filter(row => row.name !== 'identical stdout rejection without diagnostic attempt').map(row => row.name), originalNames);
});
const oldCore = core.original.rows.find(row => row.id === 'sink-rejection');
const newCore = core.revised.rows.find(row => row.id === 'sink-rejection');
check('all core dispatch inputs unchanged; target reason identity, stdout-only write and cleanup unchanged', () => {
  assert.deepEqual(core.original.rows.map(row => ({ id: row.id, payload: row.payload })), core.revised.rows.map(row => ({ id: row.id, payload: row.payload })));
  assert.deepEqual(newCore.value.result, oldCore.value.result);
  assert.deepEqual(newCore.value.events, oldCore.value.events);
  assert.deepEqual(newCore.value.result, { state: 'rejected', stderrReasonIdentity: false, stdoutReasonIdentity: true, writes: ['stdout'] });
  assert.equal(newCore.value.activeBeforeSafetyCleanup, 0);
  assert.equal(oldCore.value.activeBeforeSafetyCleanup, 0);
  assert.equal(newCore.terminationAwaited, true);
  assert.equal(oldCore.terminationAwaited, true);
  assert.equal(newCore.deadlineMs, 2000);
  assert.equal(oldCore.deadlineMs, 2000);
});
check('source archive authentication and only one revised canonical overlay', () => {
  assert.equal(hash(git('archive', '--format=tar', manifest.candidate, ...candidate.selected)), candidate.archiveSha256);
  const changed = [];
  for (const file of candidate.sourceFiles) {
    assert.equal(hash(git('cat-file', 'blob', file.blob)), file.sha256, file.path);
    assert.equal(load('original-source-before.json')[file.path].sha256, file.sha256, file.path);
    const revisedHash = load('revised-source-before.json')[file.path].sha256;
    if (revisedHash !== file.sha256) changed.push(file.path);
  }
  assert.deepEqual(changed, ['tests/commands/expr/contracts.test.ts']);
  assert.equal(load('revised-source-before.json')[changed[0]].sha256, hash(readFileSync(join(owned, 'revised/canonical/contracts.test.ts.data'))));
  const original = readFileSync(join(owned, 'original/canonical/contracts.test.ts.data'), 'utf8');
  const revised = readFileSync(join(owned, 'revised/canonical/contracts.test.ts.data'), 'utf8');
  const suffix = '  const reason = new Error("diagnostic sink failure");\n  await assert.rejects(run([], {}, { stderr: { async write() { throw reason; } } }), error => error === reason);\n});';
  assert(original.includes(suffix) && revised.includes(suffix));
  assert(revised.includes('error => error === stdoutReason'));
  assert(revised.includes('assert.equal(diagnosticWrites, 0)'));
  assert.deepEqual(load('original-compiled-before.json'), load('revised-compiled-before.json'));
});
check('selected runtime, installed package, tooling and original trees unchanged including appended entries', () => {
  const integrity = load('INTEGRITY.json');
  assert.equal(integrity.detectsAddedEntries, true);
  assert(Object.values(integrity.checks).every(Boolean));
  for (const profile of ['original', 'revised']) assert.deepEqual(load(`${profile}-runtime-before.json`), load(`${profile}-runtime-after.json`));
  for (const prefix of ['installed', 'tooling', 'original-trees']) assert.deepEqual(load(`${prefix}-before.json`), load(`${prefix}-after.json`));
  for (const [path, expected] of Object.entries(load('original-trees-before.json'))) assert.deepEqual(inventory(join(root, 'tests/commands/expr-stress', path)), expected);
});
check('normal cleanup and bounded cooperative workers; no false original passes', () => {
  const cleanup = load('CLEANUP.json');
  assert.equal(cleanup.absent, true);
  assert(!existsSync(join(root, cleanup.scratch)));
  assert(cleanup.boundedProcesses.every(row => !row.signal && !row.error));
  for (const profile of ['original', 'revised']) {
    assert.equal(nearby[profile].activeWorkers, 0);
    assert.equal(quota[profile].activeAfterSafety, 0);
    assert.equal(quota[profile].safetyTerminations, 0);
    assert.deepEqual(quota[profile].unhandledRejections, []);
    assert(core[profile].rows.every(row => row.terminationAwaited && row.deadlineMs === 2000));
  }
});
for (const freezePath of ['CAPTURE-FREEZE.json', 'CAPTURE-FREEZE-v2.json']) for (const file of JSON.parse(readFileSync(join(owned, freezePath))).files) assert.equal(hash(readFileSync(join(owned, file.path))), file.sha256);
const result = { label, auditedAt: new Date().toISOString(), candidate: candidate.candidate, canonicalCommit: candidate.canonicalCommit, inputs, checks, summaries: summary.separateNewReruns,
  targetEffects: { core: newCore.value.result, quota: { actual: newQuota.actual, attempts: newQuota.attempts, events: newQuota.events, exactIdentityCheck: newQuota.checks.find(row => row.name === 'identical stdout rejection without diagnostic attempt') }, nearby: { observed: newNearby.observed, jobs: newNearby.jobs, events: newNearby.events, budgetCount: newNearby.budgetCount, sessionCount: newNearby.sessionCount } },
  historicalQualification: 'candidate-01 stays unchanged; its initial quota comparator-only result is not promoted to a direct identity assertion. Historical author 558/559, final 236/237, 145/146, 15/16 and 46/47 are preserved independently from both new captures.',
  limits: 'These are author-selected observational checks, not independent verification, a consolidated profile audit, all canonical tests, native parity, a public export, performance, superiority, 72 hours or whole-project completion.' };
if (process.argv[3] === '--capture') writeFileSync(join(output, 'AUDIT.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ label, checks: checks.length, allPassed: true, evidenceWritten: process.argv[3] === '--capture' }));
