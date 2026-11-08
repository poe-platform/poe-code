import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {publishPythonBuildWheel} from './build-wheel.js';
import {createPythonPackageEnvironment} from './provisioning.js';

const filename='fixture-1.0-py3-none-any.whl';
async function fixture(){
 const backing=new MemoryFileSystem();
 await backing.mkdir('/build');await backing.mkdir('/wheels');
 await backing.writeFile('/build/'+filename,new Uint8Array(131079).fill(42));
 let reads=0,closes=0;
 const fs=new Proxy(backing,{get(target,key){
  if(key==='readFile')return ()=>{throw new Error('Whole wheel read forbidden');};
  if(key==='openReadFile')return async(...args:Parameters<typeof target.openReadFile>)=>{
   const handle=await target.openReadFile(...args);reads++;
   return {...handle,async read(offset:number,count:number,options:Parameters<typeof handle.read>[2]){assert.ok(count<=65536);return handle.read(offset,count,options);},async close(){closes++;await handle.close();}};
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 return {backing,context:{fs,cwd:'/',signal:new AbortController().signal},handles:()=>[reads,closes]};
}
test('published wheel survives build deletion and opens offline with integrity',async()=>{
 const {backing,context,handles}=await fixture();
 const wheel=await publishPythonBuildWheel('/build/'+filename,'/wheels',200000,context);
 assert.ok(wheel.url.endsWith('/'+filename));assert.equal(wheel.size,131079);
 await backing.unlink('/build/'+filename);
 const environment=createPythonPackageEnvironment({offline:true});
 const start=await environment.prepare(context);
 try{
  const opened=await environment.dispatch('package-open',[start.session,wheel.url,wheel.digest],context) as {key:string;size:number};
  assert.equal(opened.key,wheel.digest);assert.equal(opened.size,wheel.size);
  assert.deepEqual(await environment.dispatch('package-read',[start.session,opened.key,131072,7],context),Array(7).fill(42));
 }finally{await environment.finish(start);await environment.dispose();}
 assert.equal(handles()[0],handles()[1]);
});
test('different bytes with the same wheel filename retain both published artifacts',async()=>{
 const {backing,context}=await fixture();
 const first=await publishPythonBuildWheel('/build/'+filename,'/wheels',200000,context);
 await backing.writeFile('/build/'+filename,Uint8Array.of(9));
 const second=await publishPythonBuildWheel('/build/'+filename,'/wheels',200000,context);
 assert.notEqual(first.url,second.url);
 assert.equal((await backing.readFile(decodeURIComponent(new URL(first.url).pathname))).length,first.size);
 assert.deepEqual(await backing.readFile(decodeURIComponent(new URL(second.url).pathname)),Uint8Array.of(9));
});
test('publication rejects oversized input before creating destination entries',async()=>{
 const {backing,context,handles}=await fixture();
 await assert.rejects(publishPythonBuildWheel('/build/'+filename,'/wheels',3,context),/maxDownloadBytes/);
 assert.deepEqual(await backing.readdir('/wheels'),[]);assert.equal(handles()[0],handles()[1]);
});

test('publishing identical bytes twice returns the same durable URL',async()=>{
 const {context}=await fixture();
 assert.deepEqual(await publishPythonBuildWheel('/build/'+filename,'/wheels',200000,context),await publishPythonBuildWheel('/build/'+filename,'/wheels',200000,context));
});
test('cancellation during staging closes retained readers and removes staging',async()=>{
 const {backing,context,handles}=await fixture();
 const controller=new AbortController();
 const original=backing.createStagedFile.bind(backing);
 backing.createStagedFile=async(...args)=>{
  const stage=await original(...args);
  return {...stage,writer:{...stage.writer!,async write(...values){await stage.writer!.write(...values);controller.abort(new Error('stop publication'));}}};
 };
 await assert.rejects(publishPythonBuildWheel('/build/'+filename,'/wheels',200000,{...context,signal:controller.signal}),/stop publication/);
 for(const entry of await backing.readdir('/wheels'))assert.deepEqual(await backing.readdir('/wheels/'+entry.name),[]);
 assert.equal(handles()[0],handles()[1]);
});
test('publication rejects a substituted digest directory symlink',async()=>{
 const {backing,context}=await fixture();
 const first=await publishPythonBuildWheel('/build/'+filename,'/wheels',200000,context);
 const path='/wheels/'+first.digest;
 await backing.unlink(path+'/'+filename);await backing.rmdir(path);
 await backing.mkdir('/outside');await backing.symlink('/outside',path);
 await assert.rejects(publishPythonBuildWheel('/build/'+filename,'/wheels',200000,context));
 assert.deepEqual(await backing.readdir('/outside'),[]);
});

test('cancellation drains an admitted source read before closing its handle',async()=>{
 const {backing,context,handles}=await fixture();
 const controller=new AbortController();let release!:()=>void,entered!:()=>void,reads=0;
 const gate=new Promise<void>(resolve=>{release=resolve;}),active=new Promise<void>(resolve=>{entered=resolve;});
 const original=context.fs.openReadFile!.bind(context.fs);
 const fs=new Proxy(context.fs,{get(target,key){
  if(key==='openReadFile')return async(...args:Parameters<typeof original>)=>{
   const handle=await original(...args);
   return {...handle,async read(...values:Parameters<typeof handle.read>){
    if(args[0].startsWith('/build/')&&++reads===4){entered();await gate;}
    return handle.read(...values);
   }};
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 let settled=false;
 const publication=publishPythonBuildWheel('/build/'+filename,'/wheels',200000,{...context,fs,signal:controller.signal}).finally(()=>{settled=true;});
 const rejection=assert.rejects(publication,/stop read/);
 await active;controller.abort(new Error('stop read'));
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(settled,false);assert.equal(handles()[1],0);
 release();await rejection;assert.equal(handles()[0],handles()[1]);
 for(const entry of await backing.readdir('/wheels'))assert.deepEqual(await backing.readdir('/wheels/'+entry.name),[]);
});
