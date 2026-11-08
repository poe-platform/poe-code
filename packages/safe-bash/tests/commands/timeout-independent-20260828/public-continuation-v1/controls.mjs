import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { assertAdmission,rawInputProbe,shellInputProbe,assertRawInput,assertShellInput,assertPendingReturn } from './boundaries.mjs';
import { authenticatePreparation,recipe,save,fileHash } from './common.mjs';
authenticatePreparation(process.argv[2]);
const results=[];
const check=async(id,action)=>{try{await action();results.push({id,status:'PASS'});}catch(error){results.push({id,status:'FAIL',message:error.message,stack:error.stack});}};
const accepted={markerEntered:1,sameRegistry:true,timeoutCallable:true,outcome:{status:'fulfilled',exitCode:0,stdout:'',stderr:'',stdoutBase64:'',stderrBase64:''},dispatch:[],clockBefore:[{records:0,live:0}],clockAfter:[{records:0,live:0}]};
await check('C01-complete-admission',()=>assertAdmission(accepted));
for(const [id,change,pattern] of [
  ['C02-no-marker',row=>row.markerEntered=0,/PLUGIN_ADMISSION_MARKER/u],
  ['C03-wrong-registry',row=>row.sameRegistry=false,/PLUGIN_ADMISSION_REGISTRY/u],
  ['C04-missing-timeout',row=>row.timeoutCallable=false,/PLUGIN_ADMISSION_TIMEOUT/u],
  ['C05-rejected-setup',row=>row.outcome.status='rejected',/PLUGIN_ADMISSION_REJECTED/u],
  ['C06-setup-dispatch',row=>row.dispatch.push({phase:'setup',command:'timeout'}),/PLUGIN_SETUP_DISPATCH/u],
  ['C07-setup-output',row=>row.outcome.stdout='x',/PLUGIN_ADMISSION_STDOUT/u],
  ['C08-setup-timer',row=>row.clockAfter[0].records=1,/PLUGIN_SETUP_TIMER_EFFECT/u],
])await check(id,()=>{const row=structuredClone(accepted);change(row);assert.throws(()=>assertAdmission(row),pattern);});
await check('C09-raw-no-acquisition',()=>assertRawInput(rawInputProbe().counts));
await check('C10-raw-acquisition-mutant',()=>{const probe=rawInputProbe();assert.throws(()=>probe.source[Symbol.asyncIterator](),/RAW_STDIN_ACQUIRE/u);assert.throws(()=>assertRawInput(probe.counts),/RAW_STDIN_ACQUIRE/u);});
const latch=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
await check('C11-gated-return',async()=>{const gate=latch(),entered=latch(),probe=shellInputProbe({gate,entered}),iterator=probe.source[Symbol.asyncIterator]();let closed=false;const pending=iterator.return().then(()=>{closed=true;});await entered.promise;assert.equal(closed,false);assertShellInput(probe.counts);gate.resolve();await pending;assertShellInput(probe.counts,{closed:true});});
await check('C12-next-content-mutant',async()=>{const gate=latch(),entered=latch(),probe=shellInputProbe({gate,entered}),iterator=probe.source[Symbol.asyncIterator]();await iterator.next();assert.throws(()=>assertShellInput(probe.counts),/SHELL_STDIN_NEXT/u);gate.resolve();await iterator.return();});
await check('C13-missing-return-mutant',()=>{const probe=shellInputProbe({gate:latch(),entered:latch(),mutation:'B03'});const iterator=probe.source[Symbol.asyncIterator]();assert.equal(iterator.return,undefined);assert.throws(()=>assertShellInput(probe.counts),/SHELL_STDIN_RETURN/u);});
await check('C14-early-return-mutant',async()=>{const probe=shellInputProbe({gate:latch(),entered:latch(),mutation:'B04'});await probe.source[Symbol.asyncIterator]().return();assert.throws(()=>assertShellInput(probe.counts),/SHELL_STDIN_RETURN_SETTLEMENT/u);});
await check('C15-missing-duplicate-acquisition-shell',()=>{for(const acquire of [0,2])assert.throws(()=>assertShellInput({acquire,next:0,returned:1,settled:0,contentBytes:0}),/SHELL_STDIN_ACQUIRE/u);});
await check('C16-duplicate-return',()=>assert.throws(()=>assertShellInput({acquire:1,next:0,returned:2,settled:0,contentBytes:0}),/SHELL_STDIN_RETURN/u));
await check('C17-fulfilled-before-return',()=>assert.throws(()=>assertPendingReturn('fulfilled'),/SHELL_STDIN_EARLY_SETTLEMENT/u));
await check('C18-post-bindings',()=>authenticatePreparation(process.argv[2]));
assert.equal(results.length,18);
const receipt={schema:'timeout-public-continuation-focused-controls/1',at:new Date().toISOString(),manifestSha256:process.argv[2],requestSha256:fileHash(resolve(recipe,'CANDIDATE.json')),results,passed:results.filter(row=>row.status==='PASS').length,failed:results.filter(row=>row.status==='FAIL').length,productExecutions:0,children:0};
save(resolve(recipe,'FOCUSED-CONTROLS.json'),receipt);console.log(JSON.stringify(receipt));process.exitCode=receipt.failed?1:0;
