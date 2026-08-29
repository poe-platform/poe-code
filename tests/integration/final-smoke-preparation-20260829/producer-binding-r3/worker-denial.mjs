import workerThreads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { createTrace } from '../../agent-bash-coherent-b2-preflight-20260829/completion-r8/staged/new/trace.mjs';
assert.equal(process.env.RESOURCE_ALLOWANCE,'0');
const trace=createTrace(process.env.RESOURCE_LOG);
const NativeWorker=workerThreads.Worker;
let attempts=0;
trace({kind:'bootstrap',pid:process.pid,allowance:0});
workerThreads.Worker=class extends NativeWorker {
  constructor(){attempts++;trace({kind:'denied-worker-attempt',attempts});throw new Error('final smoke guest/Regex Worker allowance is zero');}
};
syncBuiltinESMExports();
process.once('beforeExit',()=>trace({kind:'before-exit',attempts,created:0,qualification:'main constructor interception, not universal native thread census'}));
