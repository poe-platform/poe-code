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
  assert.equal(await snapshot.readField!(129,1,0),JSON.stringify(rows[129]![1]));
  assert.equal(await snapshot.readField!(129,5,0),'null');
  await assert.rejects(snapshot.readField!(0,6,0));
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

for(const supported of [true,false])test(`saved field transport is bounded and preserves custom snapshots: supported=${supported}`,async()=>{
 const fs=new MemoryFileSystem(),context={fs,cwd:'/',signal:new AbortController().signal},store=createPythonPackageFileManifestStore({fs,directory:'/manifests'});
 const metadata='x'.repeat(8190)+'😀'+'y'.repeat(30000),row=['fixture',metadata,'origin',['unrelated'.repeat(9000)],[],null];
 await store.compareAndSet('scope',undefined,new TextEncoder().encode(JSON.stringify({version:3,installed:['fixture==1'],records:[row]})),context);
 const env=createPythonPackageEnvironment({scope:'shared',manifestStore:{...store,async openSnapshot(_scope,options){
  const snapshot=await store.openSnapshot('scope',options);assert.ok(snapshot);
  const {readField,...rest}=snapshot;
  return {...rest,...supported?{readField}: {},async readRecord(){throw new Error('whole record requested');}};
 }}});
 const start=await env.prepare({...context,recordTransport:'host'});
 try{
  const read=(field:unknown,offset:unknown)=>env.dispatch('package-record-read',[start.session,0,offset,field],context);
  if(supported){
   const expected=JSON.stringify(metadata);let actual='';
   for(let offset=0;;offset+=8192){const part=await read(1,offset) as string;assert.ok(part.length<=8192);actual+=part;if(part.length<8192)break;}
   assert.equal(actual,expected);assert.equal(await read(5,0),'null');assert.equal(await read(1,8192),expected.slice(8192,16384));
  }else assert.equal(await read(1,0),false);
  for(const field of [-1,6,1.5,'1'])await assert.rejects(read(field,0),/record/);
  await assert.rejects(read(1,-1),/record/);
 }finally{await env.finish(start);await env.dispose();}
 assert.deepEqual((await fs.readdir('/manifests')).map(entry=>entry.name).length,1);
});
