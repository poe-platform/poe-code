import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonPackageFileManifestStore} from './manifest-file.js';
import {createPythonPackageEnvironment} from './provisioning.js';

test('file manifests publish bounded writes and restore through retained caller storage',async()=>{
 const backing=new MemoryFileSystem();let maximum=0,writes=0;
 const fs=new Proxy(backing,{get(target,key){
  if(key==='writeFile'||key==='readFile'||key==='appendFile')return ()=>assert.fail('whole manifest filesystem IO');
  if(key==='createStagedFile')return async(...args:Parameters<typeof target.createStagedFile>)=>{
   const stage=await target.createStagedFile(...args),writer=stage.writer!;
   return {...stage,writer:{finish:writer.finish.bind(writer),async write(bytes:Uint8Array,...settings:Parameters<typeof writer.write> extends [unknown,...infer Rest]?Rest:never){maximum=Math.max(maximum,bytes.length);writes++;return writer.write(bytes,...settings);}}};
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const signal=new AbortController().signal,store=createPythonPackageFileManifestStore({fs,directory:'/manifests'});
 const ctx={fs,cwd:'/',signal},env=createPythonPackageEnvironment({manifestStore:store,scope:'shared'});
 const start=await env.prepare(ctx),records=[['fixture',('a'.repeat(1023)+'\ud800😀\n').repeat(100),'',[],[],null]];
 try{
  await env.dispatch('package-commit',[start.session,{version:3,installed:['fixture==1'],records}],ctx);
  const next=await env.prepare(ctx);
  try{assert.deepEqual(next.restore,['fixture==1']);assert.deepEqual(next.records,records);}
  finally{await env.finish(next);}
  assert.ok(writes>1);assert.ok(maximum<=65536);
  assert.equal((await backing.readdir('/manifests')).length,1);
 }finally{await env.finish(start);await env.dispose();}
});

test('independent file manifest stores reject stale revisions without replacing the winner',async()=>{
 const fs=new MemoryFileSystem(),options={signal:new AbortController().signal};
 const one=createPythonPackageFileManifestStore({fs,directory:'/manifests'}),two=createPythonPackageFileManifestStore({fs,directory:'/manifests'});
 assert.equal(await one.compareAndSet('shared',undefined,new Uint8Array([1]),options),true);
 const first=await one.get('shared',options),stale=await two.get('shared',options);
 assert.notEqual(first?.revision,stale?.revision,'opaque observation tokens must not collide between store instances');
 assert.equal(await two.compareAndSet('shared',first!.revision,new Uint8Array([8]),options),false);
 assert.equal((await one.get('shared',options))?.revision,first?.revision);
 assert.equal(await one.compareAndSet('shared',first!.revision,new Uint8Array([2]),options),true);
 assert.equal(await two.compareAndSet('shared',stale!.revision,new Uint8Array([3]),options),false);
 assert.deepEqual((await two.get('shared',options))?.bytes,new Uint8Array([2]));
 assert.equal((await fs.readdir('/manifests')).length,1);
});

test('serialization budget failure retires file staging and preserves the prior manifest',async()=>{
 const fs=new MemoryFileSystem(),signal=new AbortController().signal;
 const store=createPythonPackageFileManifestStore({fs,directory:'/manifests'}),options={signal};
 await store.compareAndSet('shared',undefined,new TextEncoder().encode('[]'),options);
 const before=await store.get('shared',options);
 await assert.rejects(store.compareAndSetSnapshot!('shared',before!.revision,{version:1,installed:['x'.repeat(131072)]},{signal,maxBytes:70000}),/maxManifestBytes/);
 const after=await store.get('shared',options);
 assert.deepEqual(after,before);
 assert.equal((await fs.readdir('/manifests')).length,1);
});

test('native manifest publication catches destination changes after staging',async()=>{
 const backing=new MemoryFileSystem(),options={signal:new AbortController().signal};let race=false;
 const fs=new Proxy(backing,{get(target,key){
  if(key==='publishStagedFile')return async(...args:Parameters<typeof target.publishStagedFile>)=>{
   if(race)await backing.writeFile(args[1],new Uint8Array([9]));
   return target.publishStagedFile(...args);
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const store=createPythonPackageFileManifestStore({fs,directory:'/manifests'});
 await store.compareAndSet('shared',undefined,new Uint8Array([1]),options);
 const before=await store.get('shared',options);race=true;
 assert.equal(await store.compareAndSet('shared',before!.revision,new Uint8Array([2]),options),false);
 assert.deepEqual((await store.get('shared',options))?.bytes,new Uint8Array([9]));
 assert.equal((await backing.readdir('/manifests')).length,1);
});

test('cancelling a staged manifest preserves prior bytes and retires staging',async()=>{
 const backing=new MemoryFileSystem(),controller=new AbortController(),reason=new Error('cancel manifest');let cancel=false;
 const fs=new Proxy(backing,{get(target,key){
  if(key==='createStagedFile')return async(...args:Parameters<typeof target.createStagedFile>)=>{
   const stage=await target.createStagedFile(...args),writer=stage.writer!;
   return {...stage,writer:{finish:writer.finish.bind(writer),async write(...values:Parameters<typeof writer.write>){await writer.write(...values);if(cancel)controller.abort(reason);}}};
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const store=createPythonPackageFileManifestStore({fs,directory:'/manifests'}),options={signal:controller.signal};
 await store.compareAndSet('shared',undefined,new Uint8Array([1]),options);
 const before=await store.get('shared',options);cancel=true;
 await assert.rejects(store.compareAndSet('shared',before!.revision,new Uint8Array(131072),options),error=>error===reason);
 assert.deepEqual(await store.get('shared',{signal:new AbortController().signal}),before);
 assert.equal((await backing.readdir('/manifests')).length,1);
});
