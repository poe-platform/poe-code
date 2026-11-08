import assert from 'node:assert/strict';

export function assertAdmission(record) {
  assert.equal(record.markerEntered,1,'PLUGIN_ADMISSION_MARKER');
  assert.equal(record.sameRegistry,true,'PLUGIN_ADMISSION_REGISTRY');
  assert.equal(record.timeoutCallable,true,'PLUGIN_ADMISSION_TIMEOUT');
  assert.equal(record.outcome.status,'fulfilled','PLUGIN_ADMISSION_REJECTED');
  assert.equal(record.outcome.exitCode,0,'PLUGIN_ADMISSION_STATUS');
  assert.equal(record.outcome.stdout,'','PLUGIN_ADMISSION_STDOUT');
  assert.equal(record.outcome.stderr,'','PLUGIN_ADMISSION_STDERR');
  assert.equal(record.outcome.stdoutBase64,'','PLUGIN_ADMISSION_STDOUT_BYTES');
  assert.equal(record.outcome.stderrBase64,'','PLUGIN_ADMISSION_STDERR_BYTES');
  assert.deepEqual(record.dispatch.filter(row=>row.phase==='setup'),[],'PLUGIN_SETUP_DISPATCH');
  assert.deepEqual(record.clockAfter,record.clockBefore,'PLUGIN_SETUP_TIMER_EFFECT');
}

export function rawInputProbe() {
  const counts={acquire:0,next:0,returned:0,settled:0,contentBytes:0};
  const source={ [Symbol.asyncIterator](){counts.acquire++;assert.fail('RAW_STDIN_ACQUIRE');} };
  return {source,counts};
}

export function shellInputProbe({gate,entered,mutation}) {
  const counts={acquire:0,next:0,returned:0,settled:0,contentBytes:0};
  const source={ [Symbol.asyncIterator](){
    counts.acquire++;
    const iterator={async next(){counts.next++;counts.contentBytes++;return {done:false,value:new Uint8Array([88])};}};
    if(mutation!=='B03')iterator.return=async()=>{counts.returned++;entered.resolve();if(mutation!=='B04')await gate.promise;counts.settled++;return {done:true,value:undefined};};
    return iterator;
  } };
  return {source,counts};
}

export function assertRawInput(counts) {
  assert.equal(counts.acquire,0,'RAW_STDIN_ACQUIRE');
  assert.equal(counts.next,0,'RAW_STDIN_NEXT');
  assert.equal(counts.returned,0,'RAW_STDIN_RETURN');
  assert.equal(counts.contentBytes,0,'RAW_STDIN_CONTENT');
}

export function assertShellInput(counts,{closed=false}={}) {
  assert.equal(counts.next,0,'SHELL_STDIN_NEXT');
  assert.equal(counts.contentBytes,0,'SHELL_STDIN_CONTENT');
  assert.equal(counts.acquire,1,'SHELL_STDIN_ACQUIRE');
  assert.equal(counts.returned,1,'SHELL_STDIN_RETURN');
  assert.equal(counts.settled,closed?1:0,'SHELL_STDIN_RETURN_SETTLEMENT');
}

export function assertPendingReturn(status) {assert.equal(status,'pending','SHELL_STDIN_EARLY_SETTLEMENT');}
