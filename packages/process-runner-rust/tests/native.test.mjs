import {test}from'node:test';import assert from'node:assert/strict';
import *as own from'../dist/index.js';import *as sdk from'../../process-runner/dist/index.js';import {native}from'../dist/native.js';
test('host shell avoids unused open-spec facts when explicit shell fields are supplied',async()=>{
 for(const api of [sdk,own]){
  const fault=new Error('unused shell fallback read');
  const spec={runtime:{type:'host'},uploadIgnoreFiles:[],jobLabel:{tool:'node',argv:[]},shellSpec:{command:process.execPath,args:['-e','process.exit(0)'],cwd:process.cwd(),env:{}}};
  for(const key of ['env','cwd'])Object.defineProperty(spec,key,{get(){throw fault;}});
  const env=await api.hostExecutionEnvFactory.open(spec);assert.deepEqual(await env.shell().result,{exitCode:0});
  const fallback={runtime:{type:'host'},cwd:process.cwd(),uploadIgnoreFiles:[],jobLabel:{tool:'node',argv:[]},shellSpec:{env:{}}};Object.defineProperty(fallback,'env',{get(){throw fault;}});const unresolved=await api.hostExecutionEnvFactory.open(fallback);assert.throws(()=>unresolved.shell(),error=>error===fault);
 }
});
test('native lifecycle admits exactly one settlement and retains safe group signal targets',()=>{
 for(const code of [undefined,null,0,42,255]){const state=new native.HostRun(true);assert.equal(state.killTarget(321,false),-321);assert.equal(state.killTarget(321,true),null);assert.equal(state.killTarget(undefined,false),null);assert.equal(state.finish(code),code??1);assert.equal(state.finish(0),null);}
 assert.equal(new native.HostRun(true).killTarget(-2147483648,false),2147483648);
});
test('host processes match SDK stream bytes, nonzero exits and pre-aborted admission',async()=>{
 for(const api of [sdk,own]){
  const controller=new AbortController();controller.abort();const skipped=api.createHostRunner().exec({command:'must-not-run',signal:controller.signal});assert.equal(skipped.pid,null);assert.deepEqual(await skipped.result,{exitCode:1});
  const handle=api.createHostRunner().exec({command:process.execPath,args:['-e',"process.stdout.write('one😀');process.stderr.write('two');process.exitCode=42;"],env:{},stdin:'pipe'});
  const collect=async stream=>{const parts=[];for await(const chunk of stream)parts.push(chunk);return Buffer.concat(parts).toString('utf8');};
  const [stdout,stderr,result]=await Promise.all([collect(handle.stdout),collect(handle.stderr),handle.result]);assert.equal(stdout,'one😀');assert.equal(stderr,'two');assert.deepEqual(result,{exitCode:42});
 }
});
test('pre-aborted admission does not validate unused stdio transport fields',async()=>{
 for(const api of [sdk,own]){const controller=new AbortController();controller.abort();const handle=api.createHostRunner().exec({command:'must-not-run',signal:controller.signal,stdin:Symbol('unused'),stdout:{unused:true},stderr:42});assert.equal(handle.pid,null);assert.deepEqual(await handle.result,{exitCode:1});}
});
