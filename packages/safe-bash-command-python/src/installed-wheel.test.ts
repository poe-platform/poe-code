import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem,MountFileSystem} from '@poe-code/safe-fs/core';
import {createPythonPackageEnvironment} from './provisioning.js';

test('installed local wheels retain independent caller-backed bytes without the artifact cache',async()=>{
 const fs=new MemoryFileSystem();
 await fs.mkdir('/work');
 const original='/work/fixture-1.0-py3-none-any.whl',bytes=new Uint8Array(131079).fill(42);
 await fs.writeFile(original,bytes);
 const context={fs,cwd:'/work',signal:new AbortController().signal};
 const environment=createPythonPackageEnvironment({noCache:true,cacheDirectory:'/work/cache'});
 const start=await environment.prepare(context);
 try{
  const opened=await environment.dispatch('package-open',[start.session,'file://'+original],context) as {key:string};
  const receipt=await environment.dispatch('package-retain',[start.session,opened.key],context) as {url:string;token:string};
  assert.ok(receipt.url,'installation must retain its own wheel location');
  assert.ok(receipt.url.startsWith('file:///work/cache/'));
  assert.ok(receipt.url.includes('/installed/'));
  assert.equal(new URL(receipt.url).hash,'#sha256='+opened.key);
  assert.notEqual(receipt.url,'file://'+original);
  await fs.unlink(original);
  assert.deepEqual(await environment.dispatch('package-read-retained',[start.session,receipt.token,131072,7],context),Array(7).fill(42));
  await environment.finish(start);
  const restored=await environment.prepare(context);
  try{
   const wheel=await environment.dispatch('package-open',[restored.session,receipt.url,opened.key],context) as {key:string;size:number};
   assert.equal(wheel.size,bytes.length);
   assert.deepEqual(await environment.dispatch('package-read',[restored.session,wheel.key,131072,7],context),Array(7).fill(42));
  }finally{await environment.finish(restored);}
 }finally{await environment.finish(start);await environment.dispose();}
});

test('finishing an installation drains an admitted snapshot read before retiring its source',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/work');
 await fs.writeFile('/work/fixture-1.0-py3-none-any.whl',new Uint8Array(100).fill(1));
 const environment=createPythonPackageEnvironment({noCache:true});
 let entered!:()=>void,release!:()=>void,blocked=false,closed=false;
 const active=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const open=fs.openReadFile.bind(fs);
 const observed=new Proxy(fs,{get(target,key){
 if(key==='openReadFile')return async(...args:Parameters<typeof open>)=>{
  const file=await open(...args);
  return {...file,async read(...values:Parameters<typeof file.read>){if(blocked){entered();await gate;}return file.read(...values);},async close(){closed=true;await file.close();}};
 };
 const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const context={fs:observed,cwd:'/work',signal:new AbortController().signal};
 const start=await environment.prepare(context);
 const opened=await environment.dispatch('package-open',[start.session,'file:///work/fixture-1.0-py3-none-any.whl'],context) as {key:string};
 blocked=true;
 const pending=environment.dispatch('package-retain',[start.session,opened.key],context);
 const rejected=assert.rejects(pending,/session is closed/);
 await active;
 let finished=false;
 const finishing=Promise.resolve(environment.finish(start)).then(()=>{finished=true;});
 await new Promise(resolve=>setTimeout(resolve,0));
 const premature=finished;
 assert.equal(closed,false);
 release();await rejected;await finishing;await environment.dispose();
 assert.equal(premature,false);assert.equal(closed,true);
});

for(const mounted of [false,true])test('legacy read-only staging adapters preserve their existing local wheel path; mounted='+mounted,async()=>{
 const backing=new MemoryFileSystem();await backing.mkdir('/work');
 await backing.writeFile('/work/fixture-1.0-py3-none-any.whl',Uint8Array.of(7));
 const fs=new Proxy(backing,{get(target,key){
  if(key==='capabilitiesFor')return async()=>({...target.capabilities,atomicFileStaging:false});
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const context={fs:mounted?new MountFileSystem({root:fs}):fs,cwd:'/work',signal:new AbortController().signal};
 const environment=createPythonPackageEnvironment({noCache:true}),start=await environment.prepare(context);
 try{
  const url='file:///work/fixture-1.0-py3-none-any.whl';
  const opened=await environment.dispatch('package-open',[start.session,url],context) as {key:string};
  const receipt=await environment.dispatch('package-retain',[start.session,opened.key],context) as {url:string;token:string};
  assert.equal(receipt.url,url);
  assert.deepEqual(await environment.dispatch('package-read-retained',[start.session,receipt.token,0,1],context),[7]);
  assert.deepEqual((await backing.readdir('/work')).map(entry=>entry.name),['fixture-1.0-py3-none-any.whl']);
 }finally{await environment.finish(start);await environment.dispose();}
});
