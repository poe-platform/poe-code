import assert from 'node:assert/strict';
import test from 'node:test';
import {registerYieldCheckpoint} from 'safe-bash-contracts/yield';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonPackageEnvironment} from './provisioning.js';

async function fixture() {
 const backing=new MemoryFileSystem();
 const bytes=new Uint8Array(1024*1024+7).map((_,index)=>index%251);
 await backing.writeFile('/wheel.whl',bytes);
 let closes=0,reads=0;
 const fs=new Proxy(backing,{get(target,key){
  if(key==='readFile')return ()=>assert.fail('canonical artifact was fully buffered');
  if(key==='openReadFile')return async(...args:Parameters<typeof target.openReadFile>)=>{
   const handle=await target.openReadFile(...args);
   return {stat:handle.stat.bind(handle),async read(offset:number,count:number,settings:Parameters<typeof handle.read>[2]){assert.ok(count<=65536);reads++;return handle.read(offset,count,settings);},async close(){closes++;await handle.close();}};
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const environment=createPythonPackageEnvironment({cache:{async get(){return assert.fail('canonical artifact cache read');},async set(){assert.fail('canonical artifact cache write');}}});
 const controller=new AbortController();
 const context={fs,cwd:'/',signal:controller.signal};
 const start=await environment.prepare(context);
 return {fs,bytes,environment,controller,context,start,count:()=>({closes,reads})};
}

test('canonical wheels authenticate and replay bounded retained reads without caching full bytes',async()=>{
 const f=await fixture();
 try {
  const opened=await f.environment.dispatch('package-open',[f.start.session,'file:///wheel.whl'],f.context) as {key:string;size:number};
  assert.equal(opened.size,f.bytes.length);assert.ok(f.count().reads>16);
  assert.deepEqual(await f.environment.dispatch('package-read',[f.start.session,opened.key,65530,32],f.context),Array.from(f.bytes.subarray(65530,65562)));
  await f.environment.dispatch('package-close',[f.start.session,opened.key],f.context);
  await f.environment.finish(f.start);assert.equal(f.count().closes,1);
 }finally{await f.environment.dispose();}
});

for(const retire of ['finish','abort','dispose'] as const)test(`canonical wheel handle retires exactly once on ${retire}`,async()=>{
 const f=await fixture();
 await f.environment.dispatch('package-open',[f.start.session,'file:///wheel.whl'],f.context);
 if(retire==='finish')await f.environment.finish(f.start);
 if(retire==='abort')f.controller.abort(new Error('cancelled'));
 await f.environment.dispose();assert.equal(f.count().closes,1);
});

test('canonical replay refuses changed content after authentication',async()=>{
 const f=await fixture();
 try {
  const opened=await f.environment.dispatch('package-open',[f.start.session,'file:///wheel.whl'],f.context) as {key:string};
  await f.fs.writeFile('/wheel.whl',new Uint8Array(f.bytes.length));
  await assert.rejects(f.environment.dispatch('package-read',[f.start.session,opened.key,0,32],f.context),/changed/);
 }finally{await f.environment.finish(f.start);await f.environment.dispose();}
 assert.equal(f.count().closes,1);
});

test('failed canonical integrity closes the retained artifact and leaves the session reusable',async()=>{
 const f=await fixture();
 try {
  await assert.rejects(f.environment.dispatch('package-open',[f.start.session,'file:///wheel.whl','0'.repeat(64)],f.context),/integrity mismatch/);
  assert.equal(f.count().closes,1);
  await f.environment.dispatch('package-open',[f.start.session,'file:///wheel.whl'],f.context);
 }finally{await f.environment.finish(f.start);await f.environment.dispose();}
 assert.equal(f.count().closes,2);
});

test('a handle acquired after cancellation is closed before opening settles',async()=>{
 const f=await fixture();
 let entered!:()=>void,unblock!:()=>void;
 const enteredPromise=new Promise<void>(resolve=>{entered=resolve;});
 const gate=new Promise<void>(resolve=>{unblock=resolve;});
 const fs=new Proxy(f.fs,{get(target,key){
  if(key==='openReadFile')return async(...args:Parameters<typeof target.openReadFile>)=>{const handle=await target.openReadFile(...args);entered();await gate;return handle;};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 await f.environment.finish(f.start);
 const context={...f.context,fs};const start=await f.environment.prepare(context);
 const reason=new Error('cancel delayed open');
 const pending=f.environment.dispatch('package-open',[start.session,'file:///wheel.whl'],context);
 await enteredPromise;f.controller.abort(reason);unblock();
 await assert.rejects(pending,error=>error===reason);
 await f.environment.dispose();assert.equal(f.count().closes,1);
});

test('close errors remain observable through finish and environment disposal',async()=>{
 const f=await fixture();const failure=new Error('close failed');
 const fs=new Proxy(f.fs,{get(target,key){
  if(key==='openReadFile')return async(...args:Parameters<typeof target.openReadFile>)=>{const handle=await target.openReadFile(...args);return {...handle,async close(){await handle.close();throw failure;}};};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 await f.environment.finish(f.start);
 const context={...f.context,fs};const start=await f.environment.prepare(context);
 await f.environment.dispatch('package-open',[start.session,'file:///wheel.whl'],context);
 await assert.rejects(Promise.resolve(f.environment.finish(start)),error=>error===failure);
 await assert.rejects(f.environment.dispose(),error=>error===failure);
 assert.equal(f.count().closes,1);
});

test('opening another canonical artifact retires the preceding retained handle',async()=>{
 const f=await fixture();
 try {
  await f.environment.dispatch('package-open',[f.start.session,'file:///wheel.whl'],f.context);
  await f.environment.dispatch('package-open',[f.start.session,'file:///wheel.whl'],f.context);
  assert.equal(f.count().closes,1);
 }finally{await f.environment.finish(f.start);await f.environment.dispose();}
 assert.equal(f.count().closes,2);
});


test('canonical hashing observes the caller checkpoint and releases its handle on cancellation',async()=>{
 const f=await fixture();const reason=new Error('cancel authentication');
 await f.environment.finish(f.start);
 registerYieldCheckpoint(f.context.signal,()=>{f.controller.abort(reason);});
 const start=await f.environment.prepare(f.context);
 await assert.rejects(f.environment.dispatch('package-open',[start.session,'file:///wheel.whl'],f.context),error=>error===reason);
 await f.environment.dispose();assert.equal(f.count().closes,1);assert.ok(f.count().reads<17);
});

test('buffered fallback owns canonical bytes before asynchronous cache publication',async()=>{
 const backing=new MemoryFileSystem(),borrowed=new Uint8Array([1,2,3]);
 const fs=new Proxy(backing,{get(target,key){
  if(key==='capabilitiesFor')return async()=>({...target.capabilities,retainedRead:false});
  if(key==='readFile')return async()=>borrowed;
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const environment=createPythonPackageEnvironment({cache:{async get(){return undefined;},async set(){borrowed.fill(9);}}});
 const context={fs,cwd:'/',signal:new AbortController().signal},start=await environment.prepare(context);
 try {
  const opened=await environment.dispatch('package-open',[start.session,'file:///wheel.whl'],context) as {key:string};
  assert.deepEqual(await environment.dispatch('package-read',[start.session,opened.key,0,3],context),[1,2,3]);
 }finally{await environment.finish(start);await environment.dispose();}
});

test('finish after cancellation waits for the already retiring canonical handle',async()=>{
 const f=await fixture();
 let release!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;}),begun=new Promise<void>(resolve=>{entered=resolve;});
 const fs=new Proxy(f.fs,{get(target,key){
  if(key==='openReadFile')return async(...args:Parameters<typeof target.openReadFile>)=>{
   const handle=await target.openReadFile(...args);
   return {...handle,async close(){entered();await gate;await handle.close();}};
  };
  return Reflect.get(target,key);
 }});
 const context={...f.context,fs};
 await f.environment.finish(f.start);
 const start=await f.environment.prepare(context);
 await f.environment.dispatch('package-open',[start.session,'file:///wheel.whl'],context);
 f.controller.abort(new Error('cancelled'));
 await begun;
 let finished=false;
 const finishing=Promise.resolve(f.environment.finish(start)).then(()=>{finished=true;});
 await new Promise<void>(resolve=>queueMicrotask(resolve));
 const premature=finished;
 release();await finishing;await f.environment.dispose();
 assert.equal(premature,false);
 assert.equal(f.count().closes,1);
});
