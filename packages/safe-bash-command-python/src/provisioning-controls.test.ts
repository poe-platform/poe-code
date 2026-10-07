import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonPackageEnvironment} from './provisioning.js';

test('cache bypass neither reads nor replaces artifacts and still publishes environment state',async()=>{
 const cached=new Map<string,Uint8Array>(),events:string[]=[];
 let requests=0;
 const environment=createPythonPackageEnvironment({cache:{async get(key){events.push('get');return cached.get(key);},async set(key,bytes){events.push('set');cached.set(key,bytes);}},authorize:()=>true,transport:async()=>{
  requests++;return {status:200,statusText:'OK',headers:[],body:(async function*(){yield new Uint8Array([requests]);})(),async dispose(){}};
 }});
 const context={fs:new MemoryFileSystem(),cwd:'/',signal:new AbortController().signal};
 const url='https://packages.example/fixture.whl';
 try {
  const first=await environment.prepare(context);
  await environment.dispatch('package-open',[first.session,url],context);environment.finish(first);events.length=0;
  const fresh=await environment.prepare({...context,noCache:true,pre:true});
  const artifact=await environment.dispatch('package-open',[fresh.session,url],context) as {key:string};
  assert.deepEqual(await environment.dispatch('package-read',[fresh.session,artifact.key,0,1],context),[2]);
  assert.deepEqual(events,[]);assert.equal(fresh.pre,true);
  await environment.dispatch('package-commit',[fresh.session,{version:1,installed:['fixture==1']}],context);environment.finish(fresh);
  const replay=await environment.prepare(context);assert.deepEqual(replay.restore,['fixture==1']);
  const original=await environment.dispatch('package-open',[replay.session,url],context) as {key:string};
  assert.deepEqual(await environment.dispatch('package-read',[replay.session,original.key,0,1],context),[1]);
  assert.equal(requests,2);environment.finish(replay);
  events.length=0;
  const offline=await environment.prepare({...context,offline:true,noCache:true});
  await assert.rejects(environment.dispatch('package-open',[offline.session,url],context),/Offline package cache miss/);
  assert.deepEqual(events,[]);environment.finish(offline);
 } finally {await environment.dispose();}
});

test('cache bypass preserves authorization and integrity checks and allows explicit SDK overrides',async()=>{
 let allowed=false,requests=0;
 const environment=createPythonPackageEnvironment({pre:true,noCache:true,authorize:()=>allowed,transport:async()=>{
  requests++;return {status:200,statusText:'OK',headers:[],body:(async function*(){yield new Uint8Array([1]);})(),async dispose(){}};
 }});
 const context={fs:new MemoryFileSystem(),cwd:'/',signal:new AbortController().signal};
 try {
  const first=await environment.prepare(context);assert.equal(first.pre,true);
  await assert.rejects(environment.dispatch('package-open',[first.session,'https://packages.example/wheel'],context),/authorization denied/);
  assert.equal(requests,0);allowed=true;
  await assert.rejects(environment.dispatch('package-open',[first.session,'https://packages.example/wheel','0'.repeat(64)],context),/integrity mismatch/);
  assert.equal(requests,1);environment.finish(first);
  const cached=await environment.prepare({...context,pre:false,noCache:false});assert.equal(cached.pre,undefined);
  await environment.dispatch('package-open',[cached.session,'https://packages.example/wheel'],context);environment.finish(cached);
  const replay=await environment.prepare({...context,noCache:false,offline:true});
  await environment.dispatch('package-open',[replay.session,'https://packages.example/wheel'],context);
  assert.equal(requests,2);environment.finish(replay);
 } finally {await environment.dispose();}
});

test('online index metadata refreshes while wheels remain cached and offline metadata replays',async()=>{
 let revision=1;
 const requests:string[]=[];
 const environment=createPythonPackageEnvironment({authorize:()=>true,transport:async({url})=>{
  requests.push(url);return {status:200,statusText:'OK',headers:[],body:(async function*(){yield new Uint8Array([revision]);})(),async dispose(){}};
 }});
 const context={fs:new MemoryFileSystem(),cwd:'/',signal:new AbortController().signal};
 const index='https://packages.example/simple/fixture/',wheel='https://packages.example/fixture.whl';
 async function read(session:string,url:string,metadata=false){
  const artifact=await environment.dispatch('package-open',[session,url,undefined,...metadata?['metadata']:[]],context) as {key:string};
  return environment.dispatch('package-read',[session,artifact.key,0,1],context);
 }
 try {
  const first=await environment.prepare(context);
  assert.deepEqual(await read(first.session,index,true),[1]);
  assert.deepEqual(await read(first.session,wheel),[1]);environment.finish(first);
  revision=2;
  const next=await environment.prepare(context);
  assert.deepEqual(await read(next.session,index,true),[2]);
  assert.deepEqual(await read(next.session,wheel),[1]);environment.finish(next);
  const offline=await environment.prepare({...context,offline:true});
  assert.deepEqual(await read(offline.session,index,true),[2]);environment.finish(offline);
  assert.deepEqual(requests,[index,wheel,index]);
 }finally{await environment.dispose();}
});

test('replacement controls preserve SDK defaults and explicit per-invocation overrides',async()=>{
 const environment=createPythonPackageEnvironment({upgrade:true,forceReinstall:true,noDeps:true});
 const context={fs:new MemoryFileSystem(),cwd:'/',signal:new AbortController().signal};
 try {
  const defaults=await environment.prepare(context);
  assert.equal(defaults.noDeps,true);assert.equal(defaults.upgrade,true);assert.equal(defaults.forceReinstall,true);environment.finish(defaults);
  const overridden=await environment.prepare({...context,upgrade:false,forceReinstall:false,noDeps:false});
  assert.equal(overridden.noDeps,undefined);assert.equal(overridden.upgrade,undefined);assert.equal(overridden.forceReinstall,undefined);environment.finish(overridden);
 }finally{await environment.dispose();}
});

test('package indexes preserve SDK defaults and explicit invocation overrides',async()=>{
 const environment=createPythonPackageEnvironment({indexUrl:'https://default/simple',extraIndexUrls:['https://extra/simple'],noIndex:true});
 const context={fs:new MemoryFileSystem(),cwd:'/',signal:new AbortController().signal};
 try{
  const defaults=await environment.prepare(context);
  assert.deepEqual(defaults.indexUrls,[]);await environment.finish(defaults);
  const indexed=await environment.prepare({...context,noIndex:false});
  assert.deepEqual(indexed.indexUrls,['https://default/simple','https://extra/simple']);await environment.finish(indexed);
  const override=await environment.prepare({...context,noIndex:false,indexUrl:'https://override/simple',extraIndexUrls:[]});
  assert.deepEqual(override.indexUrls,['https://override/simple']);await environment.finish(override);
 }finally{await environment.dispose();}
});
