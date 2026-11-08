import assert from 'node:assert/strict';

export const borrowedStderr = 'shell: line 1: [object Object]\n';

export function assertBorrowedCollision(receipt) {
  assert.equal(receipt.localSignal.aborted, true, 'OWN_DEADLINE_NOT_OBSERVED');
  assert.equal(receipt.callerSignal.aborted, true, 'CALLER_ABORT_NOT_ACTIVATED');
  assert.notEqual(receipt.localSignal, receipt.callerSignal, 'CALLER_IS_NOT_DISTINCT');
  assert.ok(Object.is(receipt.observedOwnReason, receipt.localSignal.reason), 'WRONG_OWN_REASON');
  assert.ok(Object.is(receipt.callerSignal.reason, receipt.observedOwnReason), 'NOT_SAME_SENTINEL');
  assert.equal(receipt.beforeRelease.handler.status, 'pending', 'HANDLER_SETTLED_BEFORE_CLOSURE');
  assert.equal(receipt.beforeRelease.outer.status, 'pending', 'OUTER_SETTLED_BEFORE_CLOSURE');
  assert.equal(receipt.handler.status, 'rejected', 'HANDLER_RETURNED_STATUS');
  assert.ok(Object.is(receipt.handler.reason, receipt.callerSignal.reason), 'WRONG_HANDLER_CALLER_REASON');
  assert.equal(receipt.rawInvoke.status, 'rejected', 'RAW_INVOKE_RETURNED_STATUS');
  assert.ok(Object.is(receipt.rawInvoke.reason, receipt.callerSignal.reason), 'WRONG_RAW_INVOKE_CALLER_REASON');
  assert.deepEqual(receipt.dispatch, { timeout: 1, child: 1, outer: 1 }, 'BORROWED_DISPATCH');
  assert.equal(receipt.outer.status, 'fulfilled', 'BORROWED_OUTER_NOT_MAPPED');
  assert.equal(receipt.outer.value.exitCode, 1, 'BORROWED_OUTER_WRONG_STATUS');
  assert.equal(receipt.outer.value.stdout, '');
  assert.equal(receipt.outer.value.stderr, borrowedStderr);
  assert.deepEqual(Buffer.from(receipt.outer.value.stdoutBytes), Buffer.alloc(0));
  assert.deepEqual(Buffer.from(receipt.outer.value.stderrBytes), Buffer.from(borrowedStderr));
  assert.equal(receipt.selectedChildClosed, true, 'SELECTED_CHILD_NOT_CLOSED');
  assert.equal(receipt.retirementSettled, true, 'RETIREMENT_NOT_SETTLED');
  assert.equal(receipt.outstandingOwnedResources, 0, 'OWNED_RESOURCES_REMAIN');
  assert.equal(receipt.rejectionsObserved, true, 'REJECTIONS_NOT_OBSERVED');
}
