import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit, historical } from './audit.mjs';
import { derive, changes, sha256 } from './fixture.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const load = path => JSON.parse(readFileSync(join(root, path)));
const freeze = load('freeze.json');
const summary = load('summary.json');
const execution = load('attempts/01/execution.json');
const base = load('attempts/01/base-results.json');
const supplement = load('attempts/01/supplement-results.json');
const controls = load('controls/02-results.json');
const original = readFileSync(join(historical, 'verification/holdouts.mts'), 'utf8');
assert.deepEqual(derive(original).receipt, freeze.fixture);
assert.deepEqual(summary.fixture, freeze.fixture);
assert.equal(summary.preparationCommit, '8b89c0e76dfe581ce57418b391e74ce299686af7');
assert.equal(summary.candidate, '0123c83d3aae72a15621acbb29a165b97b2c6ab6');
assert.equal(summary.packageSha256, '62228b67ca6793544f0f4374ca00fbbb6e627f514f184d5880fd7723ccf179c6');
for (const entry of freeze.preparationSources) assert.equal(sha256(readFileSync(join(root, entry.path))), entry.sha256);
assert.equal(sha256(readFileSync(join(root, 'attempts/01/replay-source.txt'))), execution.verifierSources.find(row => row.path === 'replay.mjs').sha256);
assert.equal(sha256(readFileSync(join(root, 'assertion-controls.mjs'))), execution.verifierSources.find(row => row.path === 'assertion-controls.mjs').sha256);
assert.equal(readFileSync(join(root, 'replay.mjs'), 'utf8'), readFileSync(join(root, 'attempts/01/replay-source.txt'), 'utf8').replace("join(destination, 'assertion-controls.json')", "join(destination, 'assertion-control-results.json')"));
const oldBase = JSON.parse(readFileSync(join(historical, 'final-shared-replay/attempts/base-01/results.json')));
const oldSupplement = JSON.parse(readFileSync(join(historical, 'final-shared-replay/attempts/supplement-01/results.json')));
assert.deepEqual(base.outcomes.map(({ id, label }) => ({ id, label })), oldBase.outcomes.map(({ id, label }) => ({ id, label })));
assert.deepEqual(supplement.rows.map(row => row.id), oldSupplement.rows.map(row => row.id));
assert.equal(oldBase.outcomes.filter(row => row.status === 'fail').length, 2);
assert.equal(base.outcomes.length, 77); assert.ok(base.outcomes.every(row => row.status === 'pass'));
assert.equal(supplement.rows.length, 5); assert.ok(supplement.rows.every(row => row.status === 'pass'));
for (const delta of changes()) {
  const row = base.outcomes.find(row => row.id === delta.id && row.label === delta.label);
  assert.equal(row.details.settlement, 'rejected'); assert.equal(row.details.rejection.identicalSentinel, true);
  assert.equal(Object.hasOwn(row.details, 'result'), false); assert.equal(row.details.returns, 1); assert.equal(row.activeWorkersAfter, 0);
  const matching = controls.rows.filter(row => row.id === delta.id);
  assert.equal(matching.length, 5);
  for (const control of matching) {
    assert.equal(control.exactPatchedBodySha256, sha256(delta.after));
    assert.equal(control.assertionRejected, control.control !== 'exact-identity-positive');
    assert.equal(control.disposeCalls, 1); assert.equal(control.execCalls, 1);
  }
}
assert.equal(controls.negativeControlsRejected, 8); assert.equal(controls.positiveControlsAccepted, 2); assert.equal(controls.productPasses, 0);
assert.equal(load('controls/01-process.json').status, 0); assert.equal(load('controls/02-process.json').status, 0);
for (const cohort of execution.cohorts) {
  assert.equal(cohort.processStatus, 0); assert.equal(cohort.receipt.forcedCleanup, false);
  assert.equal(cohort.receipt.commands.find(row => row.name === 'strict-types').status, 0);
  assert.ok(cohort.receipt.commands.every(row => row.signal === null && row.error === null && row.status === 0));
}
for (const binding of execution.driverBindings) {
  const relative = binding.cohort === 'base' ? 'verification/run-standalone.mjs' : 'verification/coverage-supplement/run-supplement.mjs';
  const originalDriver = readFileSync(join(historical, relative), 'utf8'); assert.equal(sha256(originalDriver), binding.originalSha256);
  let expected = originalDriver;
  for (const [before, after] of binding.changes) { assert.equal(expected.split(before).length, 2); expected = expected.replace(before, after); }
  assert.equal(readFileSync(join(root, `attempts/01/${binding.cohort}-driver-source.txt`), 'utf8'), expected);
  assert.equal(sha256(expected), binding.boundSha256);
}
const workerUrl = summary.packageBindings.find(row => row.path.endsWith('/worker.js')).actualResolvedUrl;
for (const [events, identity, url, expected] of [[base.workerEvents, 'threadId', 'detail', 86], [supplement.events, 'workerThreadId', 'path', 5]]) {
  const created = events.filter(row => row.event === 'create'); const exited = events.filter(row => row.event === 'exit');
  const ids = rows => rows.map(row => row[identity]).sort((left, right) => left - right);
  assert.equal(created.length, expected); assert.equal(new Set(ids(created)).size, expected); assert.deepEqual(ids(created), ids(exited));
  assert.ok(created.every(row => row[url] === workerUrl));
}
assert.equal(base.aliasUrl, summary.packageBindings.find(row => row.path === 'dist/commands/grep-aliases/index.js').actualResolvedUrl);
assert.equal(execution.publicRootResolutionBeforeImport, summary.packageBindings.find(row => row.path === 'dist/index.js').actualResolvedUrl);
assert.equal(base.activeWorkers + supplement.activeWorkers + base.lateErrorCount + base.forcedWorkerTerminationByVerifier + supplement.verifierForcedWorkerTermination, 0);
for (const checkpoint of execution.audits) {
  assert.equal(checkpoint.allGitBlobsVerified, true); assert.equal(checkpoint.additionDetectingInventories, true);
  assert.deepEqual(checkpoint.completeSource, freeze.audit.completeSource);
  assert.equal(checkpoint.finalReplaySeal, '9758c71ee82e5a6a9703c71a8ba25f6d7622e2ec7f2f1a9e8dd76558aaf9e613');
}
for (const entry of load('raw-receipts.json').exports) assert.equal(sha256(readFileSync(join(root, entry.path))), entry.sha256);
if (process.argv.includes('--retained-snapshot')) {
  const checked = audit('closed-author-evidence-verification', execution.consumer);
  assert.deepEqual(checked.completeSource, freeze.audit.completeSource);
  for (const entry of load('raw-receipts.json').exports.filter(row => row.byteForByte)) assert.deepEqual(readFileSync(join(root, entry.path)), readFileSync(entry.origin));
  assert.equal(sha256(readFileSync(join(execution.consumer, 'holdouts.mts'))), freeze.fixture.derivedSha256);
  for (const entry of execution.copies) assert.deepEqual(readFileSync(entry.original), readFileSync(entry.copy));
  for (const entry of summary.inputs) assert.equal(sha256(readFileSync(join(execution.consumer, entry.compiled))), entry.sha256);
}
function files(directory, prefix = '') { return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name), join(prefix, entry.name)) : [join(prefix, entry.name)]).sort(); }
const sealed = readFileSync(join(root, 'SHA256SUMS'), 'utf8').trim().split('\n').map(row => row.split('  '));
assert.deepEqual(sealed.map(([, path]) => path).sort(), files(root).filter(path => path !== 'SHA256SUMS'));
for (const [hash, path] of sealed) assert.equal(sha256(readFileSync(join(root, path))), hash);
console.log(JSON.stringify({ staticEvidence: 'passed', fixtureV2: { productCases: 82, pass: 82, fail: 0 }, historicalFinalReplay: { pass: 80, fail: 2, unchanged: true }, assertionControlsOnly: { negativeRejected: 8, positiveAccepted: 2 }, workersCreatedAndExited: 91, independentAcceptance: 'pending different reviewer', rootPublicIntegration: 'HOLD' }, null, 2));
