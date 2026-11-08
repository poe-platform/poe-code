import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { directory, git, hash, inventory, json, root } from './common.mjs';
import './verify-freeze.mjs';

const seal = json('BASELINE-SEAL.json');
assert.deepEqual(inventory(directory, ['BASELINE-SEAL.json']), seal.entries);
const record = json('baseline-01.json');
const frozen = json('FREEZE-MANIFEST.json');
const inputs = json('INPUTS.json');
assert.equal(record.freezeCommit, 'c0aec9fc240f153e0fa18d6e2d1e291871dbe1eb');
assert.equal(record.baseline, inputs.baseline);
assert.equal(record.failure, undefined);
assert.equal(record.integrityFailure, undefined);
assert.equal(record.probeSha256, hash(readFileSync(path.join(directory, 'baseline-probe.mjs'))));
assert.equal(record.runnerSha256, hash(readFileSync(path.join(directory, 'run-baseline.mjs'))));
assert.equal(record.workerSourceSha256, frozen.baseline.files.find(entry => entry.path === 'src/commands/expr/bre-worker.ts').sha256);
assert.equal(record.commandSourceSha256, frozen.baseline.files.find(entry => entry.path === 'src/commands/expr/index.ts').sha256);
assert.equal(record.workerCompiledSha256, record.compiledBefore.find(entry => entry.path === 'commands/expr/bre-worker.js').sha256);
for (const entry of frozen.entries) if (entry.kind === 'file') assert.equal(hash(git(['show', `${record.freezeCommit}:${path.relative(root, directory)}/${entry.path}`])), entry.sha256);
assert.equal(record.postIntegrity.sourceAndCompiledUnchanged, true);
assert.equal(record.postIntegrity.addedFilesAndEmptyDirectoriesDetected, true);
assert.equal(record.cleanup.ownedScratchRemoved, true);
assert.equal(existsSync(record.scratch), false);
const capture = record.capture;
assert.equal(capture.failure, undefined);
assert.equal(capture.rows.length, 32);
assert.deepEqual(capture.rows.map(row => row.id), inputs.cases.map(row => row.id));
assert.deepEqual(capture.counts, { focusedInputs: 32, commandInvocations: 64, supportedObservations: 21, guardedUnsupported: 9, errors: 2, newGNUProfileIssues: 0, newSafetyControls: 4, newSafetyControlsPassed: 4, historicalControlsRerun: 0 });
const supported = capture.rows.filter(row => row.classification === 'supported-observation');
assert.equal(supported.filter(row => row.profileAgreement.gnuPlus).length, 20);
assert.equal(supported.filter(row => row.profileAgreement.applePortable).length, 12);
assert.equal(capture.rows.filter(row => row.profileAgreement.gnuPlus).length, 22);
const expected = json('EXPECTED-PROFILES.json');
for (const row of capture.rows) {
  const fixture = inputs.cases.find(item => item.id === row.id);
  assert.equal(row.subject, fixture.subject);
  assert.equal(row.pattern, fixture.pattern);
  for (const form of ['portable', 'plus']) {
    const command = row.commands[form];
    assert.deepEqual(command.argv, [...(form === 'plus' ? ['+'] : []), fixture.subject, ':', fixture.pattern]);
    assert.deepEqual(command.environment, { LC_ALL: 'C' });
    assert.equal(command.registeredCleanups, 1);
    assert.equal(command.allWorkersClosed, true);
  }
  if (row.classification === 'supported-observation') {
    assert.equal(row.match.validated, true);
    const result = row.match.result;
    for (const span of [result.overall, result.capture]) if (span) {
      assert.ok(Number.isSafeInteger(span.start) && Number.isSafeInteger(span.end));
      assert.ok(0 <= span.start && span.start <= span.end && span.end <= Buffer.byteLength(row.subject));
    }
    const output = Buffer.from(`${row.match.captureHex === null ? '' : Buffer.from(row.match.captureHex, 'hex').toString()}\n`).toString('hex');
    assert.equal(row.commands.plus.stdoutHex, output);
  }
  const native = expected.rows.find(item => item.id === row.id).qualified;
  const equal = (command, observation) => command.status === observation.status && command.stdoutHex === observation.stdoutHex && command.stderrHex === observation.stderrHex;
  assert.equal(row.profileAgreement.gnuPortable, equal(row.commands.portable, native['gnu-portable']));
  assert.equal(row.profileAgreement.gnuPlus, equal(row.commands.plus, native['gnu-plus']));
  assert.equal(row.profileAgreement.applePortable, equal(row.commands.portable, native['apple-portable']));
}
assert.equal(capture.rows.find(row => row.id === 'P-aaa').rootNarrowPass, false);
assert.equal(capture.cleanup.workers, 97);
assert.equal(capture.cleanup.activeBeforeSafetyCleanup, 0);
assert.equal(capture.cleanup.activeAfterSafetyCleanup, 0);
assert.ok(capture.controls.every(control => control.passed));
console.log(JSON.stringify({ verified: true, baseline: record.baseline, freezeCommit: record.freezeCommit, counts: capture.counts, enginesExecutedByVerifier: 0, ownedSealDetectsNewFilesAndDirectories: true }));
