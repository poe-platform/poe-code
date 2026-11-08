import assert from 'node:assert/strict';

export function exact(result, expected) {
  assert.equal(result.exitCode, expected.exitCode, 'EXIT_CODE');
  assert.equal(result.stdout, expected.stdout, 'STDOUT');
  assert.equal(result.stderr, expected.stderr, 'STDERR');
  assert.equal(Buffer.from(result.stdoutBytes).toString(), expected.stdout, 'STDOUT_BYTES');
  assert.equal(Buffer.from(result.stderrBytes).toString(), expected.stderr, 'STDERR_BYTES');
}
export function delayedClosed(actual) {
  assert.equal(actual.acquired, 1, 'BODY_ACQUIRED');
  assert.equal(actual.next, 1, 'BODY_NEXT');
  assert.equal(actual.returned, 1, 'BODY_RETURNED');
  assert.equal(actual.pendingNext, 0, 'BODY_PENDING');
  assert.equal(actual.dispose, 1, 'DISPOSE_COUNT');
  assert.equal(actual.disposeDone, 1, 'DISPOSE_DONE');
  assert.equal(actual.cleanup, 1, 'CLEANUP_COUNT');
  assert.equal(actual.cleanupDone, 1, 'CLEANUP_DONE');
  assert.equal(actual.pendingBeforeRelease, true, 'CLEANUP_PENDING_SETTLEMENT');
  assert.equal(actual.closedAtSettlement, true, 'CLOSED_BEFORE_OUTER_SETTLEMENT');
}
export function deniedClosed(actual) {
  assert.deepEqual(actual.authorization.map(row => row.url), ['https://workflow.invalid/data', 'https://denied.invalid/next'], 'AUTHORIZATION_HOPS');
  assert.deepEqual(actual.authorization.map(row => row.attempt), [0, 0], 'NO_RETRIES');
  assert.equal(actual.authorization[1].redirectFrom, 'https://workflow.invalid/data', 'REDIRECT_FROM');
  assert.equal(actual.requests.length, 1, 'NO_DENIED_TRANSPORT');
  assert.equal(actual.requests[0].url, 'https://workflow.invalid/data', 'FIRST_REQUEST');
  assert.equal(actual.dispose, 1, 'REDIRECT_DISPOSE');
  assert.equal(actual.disposeDone, 1, 'REDIRECT_DISPOSE_DONE');
}
export function predicateControls() {
  const closed = { acquired: 1, next: 1, returned: 1, pendingNext: 0, dispose: 1, disposeDone: 1, cleanup: 1, cleanupDone: 1, pendingBeforeRelease: true, closedAtSettlement: true };
  const denied = { authorization: [{ url: 'https://workflow.invalid/data', attempt: 0 }, { url: 'https://denied.invalid/next', attempt: 0, redirectFrom: 'https://workflow.invalid/data' }], requests: [{ url: 'https://workflow.invalid/data' }], dispose: 1, disposeDone: 1 };
  delayedClosed(closed); deniedClosed(denied);
  const rows = [];
  for (const [id, action, message] of [
    ['request-after-denial', () => deniedClosed({ ...denied, requests: [...denied.requests, { url: 'https://denied.invalid/next' }] }), 'NO_DENIED_TRANSPORT'],
    ['cleanup-missing', () => delayedClosed({ ...closed, cleanupDone: 0 }), 'CLEANUP_DONE'],
    ['iterator-return-missing', () => delayedClosed({ ...closed, returned: 0 }), 'BODY_RETURNED'],
    ['pending-settlement-missing', () => delayedClosed({ ...closed, pendingBeforeRelease: false }), 'CLEANUP_PENDING_SETTLEMENT'],
  ]) {
    let caught; try { action(); } catch (error) { caught = error; }
    assert.equal(caught?.code, 'ERR_ASSERTION'); assert.ok(caught.message.startsWith(message));
    rows.push({ id, designatedPredicate: message, caught: { code: caught.code, message: caught.message }, qualified: true });
  }
  return rows;
}
