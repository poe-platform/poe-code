import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonPackageEnvironment} from './provisioning.js';

test('native wheel indexes spill to caller storage and preserve duplicate names and reversed stable header ordering',async()=>{
 const fs=new MemoryFileSystem(),signal=new AbortController().signal;
 const environment=createPythonPackageEnvironment(),context={fs,cwd:'/',signal};
 const start=await environment.prepare(context);
 const call=(operation:string,...args:unknown[])=>environment.dispatch('package-index',[start.session,operation,...args],context);
 try{
  await call('start');
  for(let i=0;i<130;i++)await call('append',i===129?'file-0':'file-'+i,String(i%65),JSON.stringify({ordinal:i}));
  assert.ok((await fs.readdir('/')).some(item=>item.name.startsWith('.zip-metadata-')));
  await call('seal','100');
  assert.deepEqual(JSON.parse(await call('get',0,0) as string),['{"ordinal":0}','0']);
  assert.deepEqual(JSON.parse(await call('get',65,0) as string),['{"ordinal":65}','1']);
  assert.deepEqual(JSON.parse(await call('name','file-0',0) as string),['{"ordinal":129}','100']);
  assert.equal(JSON.parse(await call('name','missing',0) as string),null);
  await assert.rejects(call('append','late','1','{}'),/sealed/);
  await call('close');
  assert.deepEqual(await fs.readdir('/'),[]);
 }finally{await environment.finish(start);await environment.dispose();}
});

for(const retire of ['finish','abort','dispose'])test('native wheel index retires caller scratch on '+retire,async()=>{
 const fs=new MemoryFileSystem(),controller=new AbortController();
 const environment=createPythonPackageEnvironment(),context={fs,cwd:'/',signal:controller.signal};
 const start=await environment.prepare(context);
 await environment.dispatch('package-index',[start.session,'start'],context);
 await environment.dispatch('package-index',[start.session,'append','name','0','payload'],context);
 if(retire==='finish')await environment.finish(start);
 if(retire==='abort')controller.abort(new Error('cancelled'));
 await environment.dispose();
 assert.deepEqual(await fs.readdir('/'),[]);
});

test('native wheel index response chunks preserve large metadata and reject weak scratch capabilities',async()=>{
 const fs=new MemoryFileSystem(),signal=new AbortController().signal,environment=createPythonPackageEnvironment();
 const context={fs,cwd:'/',signal},start=await environment.prepare(context);
 const call=(operation:string,...args:unknown[])=>environment.dispatch('package-index',[start.session,operation,...args],context);
 try{
  await call('start');
  const payload=JSON.stringify({comment:'\\\u0000😀'.repeat(20000)});
  await call('append','large','0',payload);await call('seal','1');
  let output='';
  for(let offset=0;;){const chunk=await call('get',0,offset) as string;assert.ok(chunk.length<=8192);output+=chunk;offset+=chunk.length;if(chunk.length<8192)break;}
  assert.deepEqual(JSON.parse(output),[payload,'1']);
 }finally{await environment.finish(start);await environment.dispose();}
 assert.deepEqual(await fs.readdir('/'),[]);
 const weak=new Proxy(fs,{get(target,key){if(key==='capabilitiesFor')return async()=>({...target.capabilities,retainedStagingCleanup:false});const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const other=createPythonPackageEnvironment(),weakContext={...context,fs:weak},next=await other.prepare(weakContext);
 try{await other.dispatch('package-index',[next.session,'start'],weakContext);await assert.rejects(other.dispatch('package-index',[next.session,'append','name','0','payload'],weakContext),/retained streaming scratch/);}
 finally{await other.finish(next);await other.dispose();}
 assert.deepEqual(await fs.readdir('/'),[]);
});

test('native wheel scratch uses the explicitly selected cache filesystem location',async()=>{
 const backing=new MemoryFileSystem(),signal=new AbortController().signal;
 await backing.mkdir('/cache');await backing.mkdir('/readonly');
 const fs=new Proxy(backing,{get(target,key){if(key==='createStagedFile')return (...args:Parameters<typeof target.createStagedFile>)=>{assert.ok(args[0].startsWith('/cache/'),'scratch must use caller-selected writable storage');return target.createStagedFile(...args);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const environment=createPythonPackageEnvironment({cacheDirectory:'/cache'}),context={fs,cwd:'/readonly',signal};
 const start=await environment.prepare(context);
 try{
  await environment.dispatch('package-index',[start.session,'start'],context);
  await environment.dispatch('package-index',[start.session,'append','name','0','payload'],context);
 }finally{await environment.finish(start);await environment.dispose();}
 assert.deepEqual(await backing.readdir('/cache'),[]);
});

for(const mode of ['failure','cancel'])test('native wheel index drains scratch after '+mode+' during writes',async()=>{
 const backing=new MemoryFileSystem(),controller=new AbortController(),failure=new Error('index storage interrupted');
 let interrupt=false;
 const fs=new Proxy(backing,{get(target,key){if(key==='createStagedFile')return async(...args:Parameters<typeof target.createStagedFile>)=>{
  const stage=await target.createStagedFile(...args),writer=stage.writer;assert.ok(writer);
  return {...stage,writer:{...writer,async write(...values:Parameters<typeof writer.write>){if(interrupt){if(mode==='cancel')controller.abort(failure);throw failure;}return writer.write(...values);}}};
 };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const environment=createPythonPackageEnvironment(),context={fs,cwd:'/',signal:controller.signal},start=await environment.prepare(context);
 const call=(operation:string,...args:unknown[])=>environment.dispatch('package-index',[start.session,operation,...args],context);
 await call('start');await call('append','name','0','payload');interrupt=true;
 await assert.rejects(call('seal','1'),error=>error===failure);
 if(mode==='failure')await assert.rejects(call('get',0,0),error=>error===failure);
 await environment.finish(start);await environment.dispose();
 assert.deepEqual(await backing.readdir('/'),[]);
});

 test('native wheel indexes coalesce small scratch writes',async()=>{
 const backing=new MemoryFileSystem(),signal=new AbortController().signal;
 let writes=0;
 const fs=new Proxy(backing,{get(target,key){if(key==='createStagedFile')return async(...args:Parameters<typeof target.createStagedFile>)=>{
  const stage=await target.createStagedFile(...args),writer=stage.writer;assert.ok(writer);
  return {...stage,writer:{...writer,async write(...values:Parameters<typeof writer.write>){writes++;return writer.write(...values);}}};
 };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const environment=createPythonPackageEnvironment(),context={fs,cwd:'/',signal},start=await environment.prepare(context);
 const call=(operation:string,...args:unknown[])=>environment.dispatch('package-index',[start.session,operation,...args],context);
 try{
  await call('start');
  for(let i=0;i<130;i++)await call('append','file-'+i,String(i),'{}');
  await call('seal','200');
  assert.ok(writes<200,'scratch writes: '+writes);
 }finally{await environment.finish(start);await environment.dispose();}
 assert.deepEqual(await backing.readdir('/'),[]);
});
