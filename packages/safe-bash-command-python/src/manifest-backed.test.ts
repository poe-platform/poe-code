import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonPackageFileManifestStore} from './manifest-file.js';
import {createPythonPackageEnvironment} from './provisioning.js';

test('host preparation restores caller-backed records without materializing the snapshot',async()=>{
 const fs=new MemoryFileSystem(),signal=new AbortController().signal,store=createPythonPackageFileManifestStore({fs,directory:'/manifests'});
 const rows=Array.from({length:130},(_,i)=>['fixture'+i,'Name: fixture'+i+'\n'+'x'.repeat(1024),'',[],[],null]);
 await store.compareAndSet('python-installed.json',undefined,new TextEncoder().encode(JSON.stringify({version:3,installed:['fixture==1'],records:rows})),{signal});
 const snapshot=await store.openSnapshot('python-installed.json',{signal,maxBytes:Infinity});assert.ok(snapshot);
 try{
  assert.equal(snapshot.recordCount,130);assert.deepEqual(snapshot.installed,['fixture==1']);
  assert.deepEqual(JSON.parse(await snapshot.readRecord(129,0)),rows[129]);
  assert.deepEqual(JSON.parse(await snapshot.readRecord(0,0)),rows[0]);
 }finally{await snapshot.close();}
 const env=createPythonPackageEnvironment({scope:'shared',manifestStore:{...store,openSnapshot(_scope,options){return store.openSnapshot('python-installed.json',options);},getSnapshot:async()=>{throw new Error('buffered snapshot requested');}}});
 try{
  const start=await env.prepare({fs,cwd:'/',signal,recordTransport:'host'});
  try{assert.equal(start.records,undefined);assert.equal(start.recordCount,130);assert.deepEqual(JSON.parse(await env.dispatch('package-record-read',[start.session,129,0],{fs,cwd:'/',signal}) as string),rows[129]);}
  finally{await env.finish(start);}
 }finally{await env.dispose();}
 assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['manifests']);
});

test('backed snapshots preserve duplicate-key version semantics and survive replacement',async()=>{
 const fs=new MemoryFileSystem(),signal=new AbortController().signal,store=createPythonPackageFileManifestStore({fs,directory:'/manifests'});
 const row=['fixture','Name: fixture','',['a'],[]];
 await store.compareAndSet('scope',undefined,new TextEncoder().encode('{"version":3,"installed":[],"records":'+JSON.stringify([row])+',"version":2,"installed":["fixture==1"]}'),{signal});
 const first=await store.openSnapshot('scope',{signal,maxBytes:Infinity});assert.ok(first);
 try{
  assert.equal(first.version,2);assert.deepEqual(first.installed,['fixture==1']);
  assert.equal(await store.compareAndSet('scope',first.revision,new TextEncoder().encode('["other==2"]'),{signal}),true);
  assert.deepEqual(JSON.parse(await first.readRecord(0,0)),[...row,null]);
  const second=await store.openSnapshot('scope',{signal,maxBytes:Infinity});assert.ok(second);
  try{assert.equal(second.version,0);assert.equal(second.recordCount,-1);assert.deepEqual(second.installed,['other==2']);}finally{await second.close();}
 }finally{await first.close();}
});

for(const value of ['{"version":3,"installed":[],"records":[["a","b","c",[1],[],null]]}', '{"version":1,"installed":[],"records":[]}', '{"version":3,"installed":[],"records":null}', '[1]', '{'])test('backed snapshot rejects invalid state: '+value,async()=>{
 const fs=new MemoryFileSystem(),signal=new AbortController().signal,store=createPythonPackageFileManifestStore({fs,directory:'/manifests'});
 await store.compareAndSet('scope',undefined,new TextEncoder().encode(value),{signal});
 await assert.rejects(store.openSnapshot('scope',{signal,maxBytes:Infinity}));
 assert.equal((await fs.readdir('/manifests')).length,1);
});

test('failed requirement preparation closes the admitted host snapshot',async()=>{
 const fs=new MemoryFileSystem(),signal=new AbortController().signal,store=createPythonPackageFileManifestStore({fs,directory:'/manifests'});let closed=0;
 await store.compareAndSet('scope',undefined,new TextEncoder().encode('{"version":3,"installed":[],"records":[]}'),{signal});
 const env=createPythonPackageEnvironment({scope:'shared',manifestStore:{...store,async openSnapshot(_scope,options){
  const value=await store.openSnapshot('scope',options);assert.ok(value);return {...value,async close(){closed++;await value.close();}};
 }},prepareRequirements:async()=>{throw new Error('requirement failure');}});
 try{await assert.rejects(env.prepare({fs,cwd:'/',signal,recordTransport:'host'}),/requirement failure/);assert.equal(closed,1);}finally{await env.dispose();}
});
