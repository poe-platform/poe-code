import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const historical = dirname(root);
const load = path => JSON.parse(readFileSync(join(root, path)));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const summary = load('summary.json');
const pack = load('attempts/prepare-02/receipt.json');
const execution = load('execution.json');
const base = load('attempts/base-01/results.json');
const supplement = load('attempts/supplement-01/results.json');
const diagnosis = load('diagnosis/results.json');
assert.equal(summary.candidate, '0123c83d3aae72a15621acbb29a165b97b2c6ab6');
assert.equal(pack.candidate, summary.candidate);
assert.equal(execution.candidate, summary.candidate);
assert.equal(base.candidate, summary.candidate);
assert.equal(summary.sourceOrHistoricalFixtureEdits, false);
const outcomeKeys = rows => rows.map(({ id, label }) => ({ id, label }));
assert.deepEqual(outcomeKeys(base.outcomes), outcomeKeys(JSON.parse(readFileSync(join(historical, 'verification/attempts/fixed-05/results.json'))).outcomes));
assert.deepEqual(supplement.rows.map(row => row.id), JSON.parse(readFileSync(join(historical, 'verification/coverage-supplement/attempts/03/results.json'))).rows.map(row => row.id));
assert.equal(base.outcomes.length, 77);
assert.equal(base.outcomes.filter(row => row.status === 'pass').length, 75);
assert.deepEqual(base.outcomes.filter(row => row.status === 'fail').map(row => row.id), ['S07', 'ROOT-CONTROL']);
assert.match(base.outcomes.find(row => row.status === 'fail' && row.id === 'S07').error, /^Error: external-return-sentinel\n/);
assert.match(base.outcomes.find(row => row.id === 'ROOT-CONTROL').error, /^Error: shared-grep-return-sentinel\n/);
assert.equal(supplement.rows.length, 5);
assert.ok(supplement.rows.every(row => row.status === 'pass'));
assert.deepEqual(summary.combined, { cases: 82, pass: 80, fail: 2 });
assert.deepEqual(summary.originalGroups, { executed: 38, pass: 37, fail: 1, failed: ['S07'] });
for (const cohort of execution.cohorts) {
  assert.equal(cohort.receipt.candidate, summary.candidate);
  assert.equal(cohort.receipt.packageSha256, summary.packageSha256);
  assert.equal(cohort.receipt.commands.find(row => row.name === 'strict-types').status, 0);
  assert.equal(cohort.receipt.forcedCleanup, false);
  assert.ok(cohort.receipt.commands.every(row => row.signal === null && row.error === null));
}
assert.equal(execution.cohorts[0].processStatus, 1);
assert.equal(execution.cohorts[1].processStatus, 0);
for (const item of execution.bindings) {
  const original = readFileSync(join(historical, item.cohort === 'base' ? 'verification/run-standalone.mjs' : 'verification/coverage-supplement/run-supplement.mjs'), 'utf8');
  let expected = original;
  for (const [before, after] of item.changes) { assert.equal(expected.split(before).length, 2); expected = expected.replace(before, after); }
  assert.equal(readFileSync(join(root, `attempts/${item.cohort}-01/bound-driver-source.txt`), 'utf8'), expected);
  assert.equal(sha256(original), item.originalSha256);
  assert.equal(sha256(expected), item.boundSha256);
  assert.equal(item.assertionChanges, false);
}
const workerUrl = new URL('commands/regex-execution/worker.js', diagnosis.publicRootUrl).href;
const normalized = (events, identity, url) => events.map(row => ({ event: row.event, identity: row[identity], url: row[url] }));
function validateWorkers(events) {
  const created = events.filter(row => row.event === 'create');
  const exits = events.filter(row => row.event === 'exit');
  const ids = rows => rows.map(row => row.identity).sort((left, right) => left - right);
  assert.equal(new Set(ids(created)).size, created.length);
  assert.deepEqual(ids(exits), ids(created));
  assert.ok(created.every(row => row.url === workerUrl));
  return created.length;
}
const baseEvents = normalized(base.workerEvents, 'threadId', 'detail');
assert.equal(validateWorkers(baseEvents), 86);
assert.equal(validateWorkers(normalized(supplement.events, 'workerThreadId', 'path')), 5);
assert.equal(validateWorkers(normalized(diagnosis.events, 'identity', 'url')), 2);
assert.throws(() => validateWorkers(baseEvents.filter((row, index) => index !== baseEvents.findIndex(event => event.event === 'exit'))));
assert.throws(() => validateWorkers(baseEvents.map(row => row.event === 'create' ? { ...row, url: 'file:///not-the-loaded-worker.js' } : row)));
assert.equal(base.activeWorkers + supplement.activeWorkers + diagnosis.activeWorkers, 0);
assert.equal(base.lateErrorCount, 0);
assert.deepEqual(diagnosis.lateErrors, []);
assert.equal(base.forcedWorkerTerminationByVerifier + supplement.verifierForcedWorkerTermination + diagnosis.verifierForcedTermination, 0);
assert.ok(diagnosis.rows.every(row => row.settlement === 'rejected' && row.exactReturnReasonIdentity && row.returns === 1 && row.nextCalls === 1 && row.activeWorkersAfterDispose === 0));
assert.equal(load('diagnosis/process.json').status, 0);
const bindings = pack.loadBindings;
assert.equal(bindings.find(row => row.path.endsWith('/worker.js')).sha256, summary.workers.base.loadedWorkerSha256);
for (const checkpoint of [execution.before, ...execution.cohorts.map(row => row.after), load('final-integrity.json')]) {
  assert.equal(checkpoint.fullMembershipAndNewEntryDetection, true);
  assert.deepEqual(checkpoint.source, pack.preRun.source);
  assert.deepEqual(checkpoint.package, pack.preRun.package);
  assert.deepEqual(checkpoint.loadBindings, bindings);
  assert.equal(checkpoint.dependenciesUnchanged, true);
}
for (const seal of pack.originalSeals) {
  const absolute = join(historical, seal.path);
  assert.equal(sha256(readFileSync(absolute)), seal.sha256);
  for (const row of readFileSync(absolute, 'utf8').trim().split('\n')) {
    const [digest, path] = row.split('  ');
    assert.equal(sha256(readFileSync(join(dirname(absolute), path))), digest);
  }
}
const sourceReceipts = load('source-receipts.json');
for (const entry of sourceReceipts.rawCaptureExports) assert.equal(sha256(readFileSync(join(root, entry.path))), entry.sha256);
for (const entry of sourceReceipts.sourceInputs) {
  if (entry.verifier) assert.equal(sha256(readFileSync(join(root, entry.verifier))), entry.sha256);
  if (entry.original) assert.equal(sha256(readFileSync(join(historical, entry.original.split('/tests/commands/grep-aliases-stress/')[1]))), entry.sha256);
}
const comparison = load('attempts/base-01/comparison.json');
assert.equal(comparison.executed, 26);
assert.equal(comparison.bsdExact, 16);
assert.equal(comparison.gnuExact, 0);
assert.equal(comparison.gnuPayloadProjectionOnly, 26);
assert.equal(comparison.stderrStripped, false);
if (process.argv.includes('--retained-snapshot')) {
  for (const binding of bindings) assert.equal(sha256(readFileSync(fileURLToPath(binding.url))), binding.sha256);
  assert.equal(realpathSync(fileURLToPath(workerUrl)), summary.workers.base.loadedWorkerRealpath);
  for (const entry of sourceReceipts.rawCaptureExports.filter(row => row.byteForByte)) assert.deepEqual(readFileSync(join(root, entry.path)), readFileSync(entry.origin));
  for (const entry of sourceReceipts.sourceInputs.filter(row => row.original)) assert.deepEqual(readFileSync(entry.original), readFileSync(entry.copied));
}
function files(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name), join(prefix, entry.name)) : [join(prefix, entry.name)]).sort();
}
const sealed = readFileSync(join(root, 'SHA256SUMS'), 'utf8').trim().split('\n').map(row => row.split('  '));
assert.deepEqual(sealed.map(([, path]) => path).sort(), files(root).filter(path => path !== 'SHA256SUMS'));
for (const [digest, path] of sealed) assert.equal(sha256(readFileSync(join(root, path))), digest);
console.log(JSON.stringify({ staticReceiptChecks: 'passed', toolOnlyNegativeControls: 2, productSubcases: summary.combined, originalGroups: summary.originalGroups, observedWorkersCreatedAndExited: 93, unchangedAssertionFailures: 2, rootIntegration: 'HOLD' }, null, 2));
