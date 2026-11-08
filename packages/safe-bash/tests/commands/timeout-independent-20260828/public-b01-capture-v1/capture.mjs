import assert from 'node:assert/strict';

export function captureBeforeRethrow(operation,capture) {
  try {return operation();}
  catch(reason){capture(reason);throw reason;}
}

export function assertCaptureReceipt(before,after) {
  assert.ok(before,'CAPTURE_OBSERVATION_REQUIRED');
  assert.ok(after,'RETHROW_OBSERVATION_REQUIRED');
  assert.equal(before.capturePhase,'before-rethrow','CAPTURE_PHASE');
  assert.deepEqual(before.captureOrder,['invoke','capture'],'CAPTURE_ORDER');
  assert.deepEqual(after.captureOrder,['invoke','capture','rethrow-observed'],'RETHROW_ORDER');
  assert.equal(after.sameReason,true,'CAPTURE_REASON_IDENTITY');
  for(const row of [before,after]){
    assert.deepEqual(row.counts,{acquire:1,next:0,returned:0,settled:0,contentBytes:0},'CAPTURE_COUNTERS');
    assert.equal(row.outcome.status,'rejected','CAPTURE_REJECTION');
    assert.equal(row.outcome.sameSentinel,true,'CAPTURE_REASON_IDENTITY');
    assert.equal(row.outcome.reason.name,'AssertionError','CAPTURE_REASON_NAME');
    assert.equal(row.outcome.reason.code,'ERR_ASSERTION','CAPTURE_REASON_CODE');
    assert.equal(row.outcome.reason.message,'RAW_STDIN_ACQUIRE','CAPTURE_REASON_MESSAGE');
    assert.ok(row.outcome.reason.stack.includes('[Symbol.asyncIterator]'),'CAPTURE_ORIGIN');
  }
}
