import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonPackageEnvironment, type PythonPackageEnvironment} from './provisioning.js';
import {createPythonPackageManifestStore} from './manifest.js';
import {createPythonPackageCache} from './cache.js';
import {createPythonBuildEnvironment} from './build-environment.js';

const context=()=>({fs:new MemoryFileSystem(),cwd:'/',signal:new AbortController().signal});

test('build dependencies have private snapshots even with a shared target manifest and cache directory',async()=>{
 const ctx=context(),manifestStore=createPythonPackageManifestStore();
 const options={manifestStore,scope:'target',cacheDirectory:'/cache',requirements:['application==1'],requirementFiles:['/application.txt'],profile:'documents' as const};
 await ctx.fs.writeFile('/application.txt',new TextEncoder().encode('configured==1'));
 const target=createPythonPackageEnvironment(options);
 const first=createPythonBuildEnvironment(options),second=createPythonBuildEnvironment(options);
 const publish=async(environment:PythonPackageEnvironment,installed:string[])=>{
  const start=await environment.prepare(ctx);
  await environment.dispatch('package-commit',[start.session,{version:1,installed}],ctx);
  await environment.finish(start);
 };
 try{
  await publish(target,['application==1']);
  const requested=await first.prepare({...ctx,requirements:['backend==2']});
  assert.deepEqual(requested.requested,['backend==2']);
  assert.deepEqual(requested.restore,[]);
  await first.finish(requested);
  await publish(first,['backend==2']);
  const replay=await first.prepare(ctx),sibling=await second.prepare(ctx),unchanged=await target.prepare(ctx);
  assert.deepEqual(replay.restore,['backend==2']);
  assert.deepEqual(sibling.restore,[]);
  assert.deepEqual(unchanged.restore,['application==1']);
  await first.finish(replay);await second.finish(sibling);await target.finish(unchanged);
  await first.dispose();await second.dispose();
  const after=await target.prepare(ctx);assert.deepEqual(after.restore,['application==1']);await target.finish(after);
 }finally{await first.dispose();await second.dispose();await target.dispose();manifestStore.dispose();}
});

test('build artifact reuse retains caller cache ownership and authorization',async()=>{
 const ctx=context(),cache=createPythonPackageCache();let requests=0,authorized=0;
 const options={cache,authorize:()=>{authorized++;return true;},transport:async()=>{
  requests++;return {status:200,statusText:'OK',headers:[],body:(async function*(){yield new Uint8Array([1,2,3]);})(),async dispose(){}};
 }};
 const build=createPythonBuildEnvironment(options),target=createPythonPackageEnvironment(options);
 const url='https://packages.example/backend.whl';
 try{
  const first=await build.prepare(ctx);
  await build.dispatch('package-open',[first.session,url],ctx);await build.finish(first);await build.dispose();
  const next=await target.prepare({...ctx,offline:true});
  const artifact=await target.dispatch('package-open',[next.session,url],ctx) as {key:string};
  assert.deepEqual(await target.dispatch('package-read',[next.session,artifact.key,0,3],ctx),[1,2,3]);
  assert.equal(requests,1);assert.equal(authorized,1);await target.finish(next);
 }finally{await build.dispose();await target.dispose();cache.dispose();}
});

test('build admission preserves download, manifest and requirement budgets',async()=>{
 const ctx=context();await ctx.fs.writeFile('/requirements.txt',new TextEncoder().encode('backend==1'));
 const build=createPythonBuildEnvironment({maxManifestBytes:40,maxDownloadBytes:2,maxRequirementBytes:2,authorize:()=>true,transport:async()=>({status:200,statusText:'OK',headers:[],body:(async function*(){yield new Uint8Array(3);})(),async dispose(){}})});
 try{
  await assert.rejects(build.prepare({...ctx,requirementFiles:['/requirements.txt']}));
  const start=await build.prepare(ctx);
  await assert.rejects(build.dispatch('package-open',[start.session,'https://packages.example/backend.whl'],ctx),/maxDownloadBytes/);
  await assert.rejects(build.dispatch('package-commit',[start.session,{version:1,installed:['backend-with-long-name==1']}],ctx),/maxManifestBytes/);
  await build.finish(start);
  const unchanged=await build.prepare(ctx);assert.deepEqual(unchanged.restore,[]);await build.finish(unchanged);
 }finally{await build.dispose();}
});

test('build disposal aborts downloads and waits for observable transport retirement',async()=>{
 const ctx=context();let entered!:()=>void,release!:()=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;}),retiring=new Promise<void>(resolve=>{release=resolve;});
 const failure=new Error('transport retirement failed');
 const build=createPythonBuildEnvironment({authorize:()=>true,transport:async({signal})=>({status:200,statusText:'OK',headers:[],body:(async function*(){
  entered();await new Promise<void>((_,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});yield new Uint8Array();
 })(),async dispose(){await retiring;throw failure;}})});
 const start=await build.prepare(ctx);
 const opening=build.dispatch('package-open',[start.session,'https://packages.example/backend.whl'],ctx);
 const rejected=assert.rejects(opening,error=>error===failure);
 await started;
 let settled=false;const disposal=build.dispose();void disposal.then(()=>{settled=true;});
 assert.equal(build.dispose(),disposal);
 await Promise.resolve();assert.equal(settled,false);release();
 await rejected;await disposal;
 await assert.rejects(build.prepare(ctx),/disposed/);
});

test('failed retained-handle retirement remains observable on repeated build disposal',async()=>{
 const backing=new MemoryFileSystem(),failure=new Error('build artifact close failed');let closed=0;
 await backing.writeFile('/backend.whl',new Uint8Array([1]));
 const fs=new Proxy(backing,{get(target,key){
  if(key==='openReadFile')return async(...args:Parameters<typeof target.openReadFile>)=>{
   const handle=await target.openReadFile(...args);
   return {stat:handle.stat.bind(handle),read:handle.read.bind(handle),async close(){closed++;await handle.close();throw failure;}};
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const build=createPythonBuildEnvironment(),ctx={fs,cwd:'/',signal:new AbortController().signal};
 const start=await build.prepare(ctx);
 await build.dispatch('package-open',[start.session,'file:///backend.whl'],ctx);
 const disposal=build.dispose();
 assert.equal(build.dispose(),disposal);
 await assert.rejects(disposal,error=>error===failure);
 await assert.rejects(build.dispose(),error=>error===failure);
 assert.equal(closed,1);
});

test('build dependency fetches cannot bypass the target network policy',async()=>{
 const ctx=context();let requests=0;
 const build=createPythonBuildEnvironment({authorize:()=>false,transport:async()=>{requests++;throw new Error('must not request');}});
 try{
  const start=await build.prepare(ctx);
  await assert.rejects(build.dispatch('package-open',[start.session,'https://packages.example/backend.whl'],ctx),/authorization denied/);
  assert.equal(requests,0);await build.finish(start);
 }finally{await build.dispose();}
});

test('application constraints do not constrain isolated build dependencies',async()=>{
 const ctx=context();
 const build=createPythonBuildEnvironment({constraints:['backend<1'],constraintFiles:['/absent-target-constraints']});
 try{
  const prepared=await build.prepare({...ctx,requirements:['backend==2'],constraints:['backend<1'],constraintFiles:['/absent-invocation-constraints']});
  assert.deepEqual(prepared.requested,['backend==2']);assert.equal(prepared.constraints,undefined);
  await build.finish(prepared);
 }finally{await build.dispose();}
});
