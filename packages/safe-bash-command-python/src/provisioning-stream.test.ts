import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonPackageEnvironment} from './provisioning.js';

for(const noCache of [false,true])test(`network wheel uses bounded caller staging; noCache=${noCache}`,async()=>{
 const backing=new MemoryFileSystem();let written=0,requests=0,disposed=0;
 const fs=new Proxy(backing,{get(target,key){
  if(key==='readFile')return async(path:string,...args:Parameters<typeof target.readFile> extends [string,...infer Rest]?Rest:never)=>{
   assert.ok(!path.includes('-sha256-'),'cached wheel must use retained reads');return target.readFile(path,...args);
  };
  if(key==='writeFile')return async(path:string,bytes:Uint8Array,...args:Parameters<typeof target.writeFile> extends [string,Uint8Array,...infer Rest]?Rest:never)=>{
   assert.ok(!path.includes('-sha256-'),'wheel must not be published as a whole buffer');return target.writeFile(path,bytes,...args);
  };
  if(key==='createStagedFile')return async(...args:Parameters<typeof target.createStagedFile>)=>{
   const stage=await target.createStagedFile(...args);assert.ok(stage.writer);
   return {...stage,writer:{...stage.writer,async write(bytes:Uint8Array,options:Parameters<NonNullable<typeof stage.writer>['write']>[1]){assert.ok(bytes.length<=65536);await stage.writer!.write(bytes,options);written+=bytes.length;}}};
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const total=65536*3+7;
 const environment=createPythonPackageEnvironment({cacheDirectory:'/cache',noCache,authorize:()=>true,transport:async()=>{
  requests++;return {status:200,statusText:'OK',headers:[],body:(async function*(){let sent=0;while(sent<total){if(sent)assert.equal(written,sent,'backpressure must stage each chunk before pulling another');const count=Math.min(65536,total-sent);yield new Uint8Array(count).fill(23);sent+=count;}})(),async dispose(){disposed++;}};
 }});
 const context={fs,cwd:'/',signal:new AbortController().signal};
 try{
  const start=await environment.prepare(context);
  const opened=await environment.dispatch('package-open',[start.session,'https://packages.example/wheel.whl'],context) as {key:string;size:number};
  assert.equal(opened.size,total);assert.equal(written,total);
  assert.deepEqual(await environment.dispatch('package-read',[start.session,opened.key,total-7,7],context),[23,23,23,23,23,23,23]);
  await environment.finish(start);assert.equal(disposed,1);
  if(!noCache){
   const next=await environment.prepare({...context,offline:true});
   const cached=await environment.dispatch('package-open',[next.session,'https://packages.example/wheel.whl'],context) as {key:string};
   assert.equal(cached.key,opened.key);assert.equal(requests,1);
   await environment.finish(next);
  }
 }finally{await environment.dispose();}
});

for(const failure of ['body','integrity','limit','progress'] as const)test(`failed streamed download cleans caller staging: ${failure}`,async()=>{
 const fs=new MemoryFileSystem();let disposed=0;
 const environment=createPythonPackageEnvironment({noCache:true,authorize:()=>true,...failure==='limit'?{maxDownloadBytes:3}:{},onProgress(){if(failure==='progress')throw new Error('progress failed');},transport:async()=>({status:200,statusText:'OK',headers:[],body:(async function*(){yield Uint8Array.of(1,2,3,4);if(failure==='body')throw new Error('body failed');})(),async dispose(){disposed++;}})});
 const context={fs,cwd:'/',signal:new AbortController().signal};
 const start=await environment.prepare(context);
 try{
  await assert.rejects(environment.dispatch('package-open',[start.session,'https://packages.example/wheel',failure==='integrity'?'0'.repeat(64):undefined],context));
  assert.deepEqual(await fs.readdir('/'),[]);assert.equal(disposed,1);
 }finally{await environment.finish(start);await environment.dispose();}
});

test('cancellation interrupts a stalled network body and cleans its staging',async()=>{
 const fs=new MemoryFileSystem(),controller=new AbortController();let release!:()=>void,entered!:()=>void,retired=0,disposed=0;
 const gate=new Promise<void>(resolve=>{release=resolve;}),reading=new Promise<void>(resolve=>{entered=resolve;});
 const environment=createPythonPackageEnvironment({noCache:true,authorize:()=>true,transport:async()=>({status:200,statusText:'OK',headers:[],body:{[Symbol.asyncIterator](){return {async next(){entered();await gate;return {done:true as const,value:undefined};},async return(){retired++;return {done:true as const,value:undefined};}};}},async dispose(){disposed++;}})});
 const context={fs,cwd:'/',signal:controller.signal},start=await environment.prepare(context);
 let settled=false;
 const opening=environment.dispatch('package-open',[start.session,'https://packages.example/wheel'],context).finally(()=>{settled=true;});
 const rejected=assert.rejects(opening,/stop download/);
 try{
  await reading;controller.abort(new Error('stop download'));
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(settled,true,'stalled source must not retain the package session');
  await rejected;assert.equal(retired,1);assert.equal(disposed,1);assert.deepEqual(await fs.readdir('/'),[]);
 }finally{release();await rejected;await environment.dispose();}
});

for(const change of ['corrupt','remove'] as const)test(`streamed offline cache detects ${change} artifact`,async()=>{
 const fs=new MemoryFileSystem();let requests=0;
 const environment=createPythonPackageEnvironment({cacheDirectory:'/cache',authorize:()=>true,transport:async()=>{requests++;return {status:200,statusText:'OK',headers:[],body:(async function*(){yield Uint8Array.of(4,5,6);})(),async dispose(){}};}});
 const context={fs,cwd:'/',signal:new AbortController().signal};
 try{
  const start=await environment.prepare(context);
  const opened=await environment.dispatch('package-open',[start.session,'https://packages.example/wheel'],context) as {key:string};
  await environment.finish(start);
  const {pythonPackageRuntimeKey:key}=await import('./cache.js');
  const path='/cache/'+key+'/'+key+'-sha256-'+opened.key;
  if(change==='corrupt')await fs.writeFile(path,Uint8Array.of(9));else await fs.unlink(path);
  const offline=await environment.prepare({...context,offline:true});
  await assert.rejects(environment.dispatch('package-open',[offline.session,'https://packages.example/wheel'],context),change==='corrupt'?/cache integrity mismatch/:/Offline package cache miss/);
  assert.equal(requests,1);await environment.finish(offline);
 }finally{await environment.dispose();}
});

test('oversized cache metadata never publishes a staged wheel',async()=>{
 const fs=new MemoryFileSystem();
 const environment=createPythonPackageEnvironment({cacheDirectory:'/cache',maxMetadataBytes:1,authorize:()=>true,transport:async()=>({status:200,statusText:'OK',headers:[],body:(async function*(){yield Uint8Array.of(1);})(),async dispose(){}})});
 const context={fs,cwd:'/',signal:new AbortController().signal},start=await environment.prepare(context);
 try{
  await assert.rejects(environment.dispatch('package-open',[start.session,'https://packages.example/wheel'],context),/maxMetadataBytes/);
  const {pythonPackageRuntimeKey:key}=await import('./cache.js');
  assert.deepEqual(await fs.readdir('/cache/'+key),[]);
 }finally{await environment.finish(start);await environment.dispose();}
});

test('download refuses staging changed between sealing and retained acquisition',async()=>{
 const backing=new MemoryFileSystem();let changed=false;
 const fs=new Proxy(backing,{get(target,key){
  if(key==='openReadFile')return async(...args:Parameters<typeof target.openReadFile>)=>{
   if(!changed&&args[0].includes('.python-package-')){changed=true;await target.writeFile(args[0],Uint8Array.of(9));}
   return target.openReadFile(...args);
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const environment=createPythonPackageEnvironment({noCache:true,authorize:()=>true,transport:async()=>({status:200,statusText:'OK',headers:[],body:(async function*(){yield Uint8Array.of(1);})(),async dispose(){}})});
 const context={fs,cwd:'/',signal:new AbortController().signal},start=await environment.prepare(context);
 try{await assert.rejects(environment.dispatch('package-open',[start.session,'https://packages.example/wheel'],context),/changed/);}
 finally{await environment.finish(start);await environment.dispose();}
});
