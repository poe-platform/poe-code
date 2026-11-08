import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

export function makeTrace() {
  const events = [];
  return {
    events,
    record(name, fields = {}) {
      const event = { ...fields, sequence: events.length, name, monotonicMs: performance.now() };
      events.push(event);
      return event;
    },
  };
}

export async function within(promise, label, deadlineMs = 1200) {
  assert.ok(Number.isSafeInteger(deadlineMs) && deadlineMs > 0);
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label}: exceeded ${deadlineMs}ms`)), deadlineMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export function assertOrder(events, names) {
  let previous = -1;
  for (const name of names) {
    const index = events.findIndex((event, current) => current > previous && event.name === name);
    assert.ok(index > previous, `Missing or out-of-order event: ${name}`);
    previous = index;
  }
}

export function assertOwnedFirstRead(observation) {
  assert.equal(observation.started, 1, 'Exactly one owned read/request must start');
  assert.equal(observation.returned, 1);
  assert.equal(observation.active, 0);
  assert.equal(observation.firstWrites, 0);
  assert.equal(observation.operationAborted, true);
  assert.equal(observation.operationReason?.code, 'EPIPE');
  assert.equal(observation.stageAbortedAtClose, false);
  assert.equal(observation.callerAbortedAtClose, false);
  assert.equal(observation.stageEffectAfterCancel, true);
  assert.equal(observation.cleanupCompletedBeforeSettlement, true);
  assert.deepEqual(observation.unhandled, []);
  assertOrder(observation.events, [
    'operation.enrolled',
    'source.started',
    'downstream.completed',
    'operation.aborted',
    'independent.effect',
    'cleanup.completed',
    'exec.settled',
  ]);
}

export function assertSharedRemainder(observation) {
  assert.deepEqual(observation.firstBytes, Buffer.from('first\n'));
  assert.deepEqual(observation.remainingBytes, Buffer.from('second\nthird\n'));
  assert.equal(observation.returnedBeforeOwnerTeardown, 0);
  assert.ok(observation.returnedAfterOwnerTeardown <= 1);
  assert.equal(observation.stageAborted, false);
  assert.equal(observation.callerAborted, false);
}

export function assertIndependentEffects(observation) {
  assert.deepEqual(observation.fileBytes, Buffer.from('kept\n'));
  assert.deepEqual(observation.stderrBytes, Buffer.from('independent\n'));
  assert.equal(observation.stageAbortedAtEffect, false);
  assert.equal(observation.exitCode, 0);
}

export function assertMixedCurlFiles(observation, required) {
  assert.equal(observation.requestsStarted, 1);
  assert.equal(observation.requestCanceledBeforeRequiredFiles, false);
  assert.deepEqual(observation.stdoutBytes, Buffer.alloc(0));
  assert.deepEqual(observation.stderrBytes, Buffer.alloc(0));
  assert.equal(observation.stageAbortedAtOutputClose, false);
  assert.equal(observation.callerAbortedAtOutputClose, false);
  if (required.body) assert.deepEqual(observation.bodyBytes, Buffer.from('body-one\nbody-two\n'));
  if (required.headers) {
    assert.ok(observation.expectedHeaderBytes instanceof Uint8Array);
    assert.ok(observation.expectedHeaderBytes.length > 0);
    assert.deepEqual(observation.headerBytes, observation.expectedHeaderBytes);
  }
  assert.ok([0, 141].includes(observation.producerStatus));
  assert.equal(observation.pipelineStatus, observation.pipefail ? observation.producerStatus : 0);
}
