import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonPackageEnvironment} from './provisioning.js';
import {createPythonPackageStreamingManifestStore} from './manifest.js';

test('streaming store adapter preserves receiver, byte compatibility and source retirement',async()=>{
 const signal=new AbortController().signal,reason=new Error('publication failed');
 let fail=false,iterator:AsyncIterator<Uint8Array>|undefined;
 const owner={
  async get(scope:string){assert.equal(this,owner);assert.equal(scope,'scope');return {revision:'before',bytes:new Uint8Array([1])};},
  async compareAndSet(scope:string,revision:string|undefined,source:AsyncIterable<Uint8Array>){
   assert.equal(this,owner);assert.equal(scope,'scope');assert.equal(revision,'before');
   iterator=source[Symbol.asyncIterator]();
   const first=await iterator.next();
   if(fail)throw reason;
   assert.deepEqual(first.value,new Uint8Array([1,2,3]));
   assert.equal((await iterator.next()).done,true);return true;
  },
 };
 const store=createPythonPackageStreamingManifestStore(owner);
 assert.equal((await store.get('scope',{signal}))?.revision,'before');
 assert.equal(await store.compareAndSet('scope','before',new Uint8Array([1,2,3]),{signal}),true);
 fail=true;
 await assert.rejects(store.compareAndSetSnapshot!('scope','before',{version:1,installed:[]},{signal,maxBytes:Infinity}),error=>error===reason);
 assert.equal((await iterator!.next()).done,true);
});

test('manifest publication streams escaped large metadata without the buffered store method',async()=>{
 const controller=new AbortController(),ctx={fs:new MemoryFileSystem(),cwd:'/',signal:controller.signal};
 const snapshot={version:3,installed:['fixture==1'],records:[['fixture',('x'.repeat(1023)+'\ud83d\ude00\ud800\n').repeat(100),'',[],[],null]]};
 let bytes=0,chunks=0,stored='';
 const store=createPythonPackageStreamingManifestStore({
  async get(){return undefined;},
  async compareAndSet(_scope,revision,source,{signal}){
   assert.equal(revision,undefined);assert.equal(signal.aborted,false);
   const decoder=new TextDecoder();
   for await(const chunk of source){assert.ok(chunk.length<=6144);chunks++;bytes+=chunk.length;stored+=decoder.decode(chunk,{stream:true});}
   stored+=decoder.decode();return true;
  },
 });
 store.compareAndSet=async()=>assert.fail('buffered publication');
 const env=createPythonPackageEnvironment({manifestStore:store,scope:'stream'}),start=await env.prepare(ctx);
 try{
  await env.dispatch('package-commit',[start.session,snapshot],ctx);
  assert.ok(chunks>100);assert.equal(bytes,new TextEncoder().encode(JSON.stringify(snapshot)).length);
  assert.equal(stored,JSON.stringify(snapshot));
 }finally{await env.finish(start);await env.dispose();}
});

for(const outcome of ['limit','cancel','incomplete','conflict'] as const)test(`streamed manifest publication preserves ${outcome} failure`,async()=>{
 const controller=new AbortController(),ctx={fs:new MemoryFileSystem(),cwd:'/',signal:controller.signal};
 const reason=new Error('cancel publication');let installed=0,completed=false;
 const store=createPythonPackageStreamingManifestStore({
  async get(){return undefined;},
  async compareAndSet(_scope,_revision,source){
   if(outcome==='conflict')return false;
   if(outcome==='incomplete')return true;
   for await(const chunk of source){assert.ok(chunk.length);if(outcome==='cancel')controller.abort(reason);}
   completed=true;return true;
  },
 });
 store.compareAndSet=async()=>assert.fail('buffered publication');
 const env=createPythonPackageEnvironment({manifestStore:store,scope:'stream',...outcome==='limit'?{maxManifestBytes:8}:{},onProgress(){installed++;}});
 const start=await env.prepare(ctx);
 try{
  await assert.rejects(env.dispatch('package-commit',[start.session,{version:1,installed:['fixture==1']}],ctx),error=>outcome==='cancel'?error===reason:outcome==='conflict'?(error as {code?:string}).code==='EPACKAGECONFLICT':String(error).includes(outcome==='limit'?'maxManifestBytes':'consuming'));
  assert.equal(installed,0);assert.equal(completed,false);
 }finally{await env.finish(start);await env.dispose();}
});
