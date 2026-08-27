import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { assertOwnedFirstRead, assertSharedRemainder, assertIndependentEffects, assertMixedCurlFiles, makeTrace, within } from './support.mjs';

test('scaffold only: independent cohort has exactly five adapted plus eleven new intentions', () => {
  const matrix = JSON.parse(readFileSync(new URL('./holdouts.json', import.meta.url), 'utf8'));
  assert.equal(matrix.cases.length, 16);
  assert.equal(matrix.cases.filter((entry) => entry.family === 'original-adapted').length, 5);
  assert.equal(matrix.cases.filter((entry) => entry.family === 'new').length, 11);
});

test('scaffold only: observation guard rejects stage abort and zero starts', () => {
  const trace = makeTrace();
  for (const name of ['operation.enrolled', 'source.started', 'downstream.completed', 'operation.aborted', 'independent.effect', 'cleanup.completed', 'exec.settled']) trace.record(name);
  const observation = {
    started: 1, returned: 1, active: 0, firstWrites: 0,
    operationAborted: true, operationReason: { code: 'EPIPE' },
    stageAbortedAtClose: false, callerAbortedAtClose: false,
    stageEffectAfterCancel: true, cleanupCompletedBeforeSettlement: true,
    unhandled: [], events: trace.events,
  };
  assertOwnedFirstRead(observation);
  assert.throws(() => assertOwnedFirstRead({ ...observation, stageAbortedAtClose: true }));
  assert.throws(() => assertOwnedFirstRead({ ...observation, started: 0 }));
  assert.throws(() => assertOwnedFirstRead({ ...observation, stageEffectAfterCancel: false }));
});

test('scaffold only: shared-data guard rejects byte loss and premature return', () => {
  const observation = {
    firstBytes: Buffer.from('first\n'), remainingBytes: Buffer.from('second\nthird\n'),
    returnedBeforeOwnerTeardown: 0, returnedAfterOwnerTeardown: 1,
    stageAborted: false, callerAborted: false,
  };
  assertSharedRemainder(observation);
  assert.throws(() => assertSharedRemainder({ ...observation, remainingBytes: Buffer.from('third\n') }));
  assert.throws(() => assertSharedRemainder({ ...observation, returnedBeforeOwnerTeardown: 1 }));
});

test('scaffold only: effect guard rejects suppressed diagnostic and lost file', () => {
  const observation = {
    fileBytes: Buffer.from('kept\n'), stderrBytes: Buffer.from('independent\n'),
    stageAbortedAtEffect: false, exitCode: 0,
  };
  assertIndependentEffects(observation);
  assert.throws(() => assertIndependentEffects({ ...observation, stderrBytes: Buffer.alloc(0) }));
  assert.throws(() => assertIndependentEffects({ ...observation, fileBytes: Buffer.alloc(0) }));
});

test('scaffold only: curl guard rejects premature cancellation and missing file', () => {
  const observation = {
    requestsStarted: 1, requestCanceledBeforeRequiredFiles: false,
    stdoutBytes: Buffer.alloc(0), stderrBytes: Buffer.alloc(0),
    stageAbortedAtOutputClose: false, callerAbortedAtOutputClose: false,
    bodyBytes: Buffer.from('body-one\nbody-two\n'),
    producerStatus: 141, pipelineStatus: 141, pipefail: true,
  };
  assertMixedCurlFiles(observation, { body: true });
  assert.throws(() => assertMixedCurlFiles({ ...observation, requestCanceledBeforeRequiredFiles: true }, { body: true }));
  assert.throws(() => assertMixedCurlFiles({ ...observation, bodyBytes: Buffer.alloc(0) }, { body: true }));
});

test('scaffold only: deadline bounds opaque promise without treating timeout as success', async () => {
  await assert.rejects(within(new Promise(() => {}), 'synthetic scaffold promise', 10), /exceeded 10ms/);
  assert.equal(await within(Promise.resolve('settled'), 'synthetic resolved promise'), 'settled');
});
