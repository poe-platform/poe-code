import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { captureBeforeRethrow,assertCaptureReceipt } from './capture.mjs';
import { rawInputProbe } from './boundaries.mjs';
import { authenticatePreparation,recipe,fileHash,save } from './common.mjs';
authenticatePreparation(process.argv[2]);
const results=[];const check=(id,action)=>{try{action();results.push({id,status:'PASS'});}catch(error){results.push({id,status:'FAIL',message:error.message,stack:error.stack});}};
const encode=(reason,original)=>({status:'rejected',sameSentinel:Object.is(reason,original),reason:{name:reason.name,code:reason.code,message:reason.message,stack:reason.stack}});
function actualProbe(){const probe=rawInputProbe(),order=[];let original,before,after;try{captureBeforeRethrow(()=>{order.push('invoke');probe.source[Symbol.asyncIterator]();},reason=>{original=reason;order.push('capture');before={capturePhase:'before-rethrow',captureOrder:[...order],counts:structuredClone(probe.counts),outcome:encode(reason,reason)};});}catch(reason){order.push('rethrow-observed');after={captureOrder:[...order],counts:structuredClone(probe.counts),sameReason:Object.is(reason,original),outcome:encode(reason,original)};}return {before,after,original};}
check('C01-normal-return-no-capture',()=>{let captures=0;const value={value:7};assert.equal(captureBeforeRethrow(()=>value,()=>{captures++;}),value);assert.equal(captures,0);});
check('C02-synchronous-order-and-identity',()=>{const reason={},order=[];let escaped;try{captureBeforeRethrow(()=>{order.push('invoke');throw reason;},caught=>{assert.equal(caught,reason);order.push('capture');});}catch(caught){escaped=caught;order.push('rethrow-observed');}assert.equal(escaped,reason);assert.deepEqual(order,['invoke','capture','rethrow-observed']);});
check('C03-actual-raw-probe-counters',()=>{const {before,after}=actualProbe();assertCaptureReceipt(before,after);});
check('C04-missing-capture-rejected',()=>{const {after}=actualProbe();assert.throws(()=>assertCaptureReceipt(undefined,after),/CAPTURE_OBSERVATION_REQUIRED/u);});
check('C05-late-capture-rejected',()=>{const {before,after}=actualProbe();before.capturePhase='after-rethrow';assert.throws(()=>assertCaptureReceipt(before,after),/CAPTURE_PHASE/u);});
check('C06-same-message-replacement-rejected',()=>{const {before,after,original}=actualProbe(),replacement=actualProbe().original;assert.equal(replacement.code,original.code);assert.equal(replacement.message,original.message);after.sameReason=Object.is(replacement,original);after.outcome=encode(replacement,original);assert.throws(()=>assertCaptureReceipt(before,after),/CAPTURE_REASON_IDENTITY/u);});
check('C07-wrong-counter-rejected',()=>{for(const [key,value] of [['acquire',0],['next',1],['returned',1],['contentBytes',1]]){const {before,after}=actualProbe();before.counts[key]=value;assert.throws(()=>assertCaptureReceipt(before,after),/CAPTURE_COUNTERS/u);}});
authenticatePreparation(process.argv[2]);assert.equal(results.length,7);
const receipt={schema:'timeout-public-b01-capture-controls/1',at:new Date().toISOString(),manifestSha256:process.argv[2],requestSha256:fileHash(resolve(recipe,'CANDIDATE.json')),results,passed:results.filter(row=>row.status==='PASS').length,failed:results.filter(row=>row.status==='FAIL').length,productExecutions:0,children:0};save(resolve(recipe,'FOCUSED-CONTROLS.json'),receipt);console.log(JSON.stringify(receipt));process.exitCode=receipt.failed?1:0;
