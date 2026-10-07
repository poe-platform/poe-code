import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonBuildBackend, type PythonBuildHookRequest} from './build-backend.js';
import {createPythonBuildEnvironment} from './build-environment.js';
import type {PythonExecutorStart} from './executor.js';

const context=()=>({fs:new MemoryFileSystem(),cwd:'/work',env:{},signal:new AbortController().signal,maxBytes:4096,stdout:{async write(){}},stderr:{async write(){}}});
const request:PythonBuildHookRequest={hook:'get_requires_for_build_wheel',source:'/project',backend:'backend:factory',backendPath:['.'],configSettings:{feature:['one','two']}};
const send=(start:PythonExecutorStart,value:any)=>start.host!.request({version:1,operation:'call',capability:'python_build',value});

test('native build hooks use the explicit environment and return bounded metadata separately from diagnostics',async()=>{
 const environment=createPythonBuildEnvironment();let retired=0;
 const backend=createPythonBuildBackend({environment,createExecutor:()=>({terminate(){retired++;},async run(start){
  assert.deepEqual(start.packages?.requested,[]);
  assert.equal(start.packages?.bootstrap,true);
  assert.deepEqual(await send(start,{op:'request'}),request);
  await start.dispatch({op:'stdout',args:[[98]]});
  await send(start,{op:'text',text:'["extra'});await send(start,{op:'text',text:'==1"]'});await send(start,{op:'done'});return 0;
 }})});
 const ctx=context(),output:number[]=[];
 try{
  assert.deepEqual(await backend(request,{...ctx,stdout:{async write(bytes){output.push(...bytes);}}}),['extra==1']);
  assert.deepEqual(output,[98]);assert.equal(retired,1);
  const next=await environment.prepare(ctx);await environment.finish(next);
 }finally{await environment.dispose();}
});

test('hook requests snapshot caller-owned backend paths and config values',async()=>{
 const environment=createPythonBuildEnvironment();let received:unknown;
 const backend=createPythonBuildBackend({environment,createExecutor:()=>({terminate(){},async run(start){received=await send(start,{op:'request'});await send(start,{op:'text',text:'[]'});await send(start,{op:'done'});return 0;}})});
 const value={...request,backendPath:['.'],configSettings:{feature:['one','two']}};
 try{
  const running=backend(value,context());value.backendPath.push('escape');value.configSettings.feature[0]='changed';
  await running;assert.deepEqual(received,request);
 }finally{await environment.dispose();}
});

test('build result admission retains the invocation metadata budget',async()=>{
 const environment=createPythonBuildEnvironment();
 const backend=createPythonBuildBackend({environment,createExecutor:()=>({terminate(){},async run(start){await send(start,{op:'text',text:'["long==1"]'});await send(start,{op:'done'});return 0;}})});
 const ctx={...context(),maxBytes:2};
 try{const running=backend(request,ctx);ctx.maxBytes=Infinity;await assert.rejects(running,/metadata limit/);}finally{await environment.dispose();}
});

test('native reporting after failed host admission preserves the original limit error',async()=>{
 const environment=createPythonBuildEnvironment();
 const backend=createPythonBuildBackend({environment,createExecutor:()=>({terminate(){},async run(start){
  try{await send(start,{op:'text',text:'["long==1"]'});}catch{await send(start,{op:'error',type:'HostError',message:'host operation failed'});}
  return 0;
 }})});
 try{await assert.rejects(backend(request,{...context(),maxBytes:2}),/metadata limit/);}finally{await environment.dispose();}
});

for(const messages of [[],[{op:'text',text:'["界界"]'},{op:'done'}],[{op:'text',text:'[]'},{op:'done'},{op:'done'}],[{op:'text',text:'[1]'},{op:'done'}]])test('invalid or over-budget build results retire their interpreter '+JSON.stringify(messages),async()=>{
 const environment=createPythonBuildEnvironment();let retired=0;
 const backend=createPythonBuildBackend({environment,createExecutor:()=>({terminate(){retired++;},async run(start){for(const message of messages)await send(start,message);return 0;}})});
 try{await assert.rejects(backend(request,{...context(),maxBytes:8}));assert.equal(retired,1);}finally{await environment.dispose();}
});

test('native backend exception type and message survive interpreter retirement',async()=>{
 const environment=createPythonBuildEnvironment();let retired=false;
 const backend=createPythonBuildBackend({environment,createExecutor:()=>({terminate(){retired=true;},async run(start){await send(start,{op:'error',type:'ValueError',message:'broken backend'});return 0;}})});
 try{await assert.rejects(backend(request,context()),error=>error instanceof Error&&error.name==='ValueError'&&error.message==='broken backend');assert.equal(retired,true);}finally{await environment.dispose();}
});

test('native build cancellation waits for interpreter retirement without disposing the caller environment',async()=>{
 const environment=createPythonBuildEnvironment(),controller=new AbortController();let enter!:()=>void,release!:()=>void,retired=false;
 const started=new Promise<void>(resolve=>{enter=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const backend=createPythonBuildBackend({environment,createExecutor:()=>({async terminate(){await gate;retired=true;},async run(start){enter();await new Promise<void>(resolve=>start.signal.addEventListener('abort',()=>resolve(),{once:true}));return 0;}})});
 try{
  const reason=new Error('cancel build'),running=backend(request,{...context(),signal:controller.signal});
  const rejected=assert.rejects(running,error=>error===reason);
  await started;controller.abort(reason);await Promise.resolve();assert.equal(retired,false);release();await rejected;assert.equal(retired,true);
  const next=await environment.prepare(context());await environment.finish(next);
 }finally{release?.();await environment.dispose();}
});

test('wheel hook results must be a wheel filename rather than an arbitrary path',async()=>{
 const environment=createPythonBuildEnvironment();let result='fixture-1-py3-none-any.whl';
 const backend=createPythonBuildBackend({environment,createExecutor:()=>({terminate(){},async run(start){await send(start,{op:'text',text:JSON.stringify(result)});await send(start,{op:'done'});return 0;}})});
 const build:PythonBuildHookRequest={hook:'build_wheel',source:'/project',backend:'backend',wheelDirectory:'/wheels'};
 try{
  assert.equal(await backend(build,context()),result);
  for(result of ['../escape.whl','/escape.whl','escape\\wheel.whl','not-a-wheel'])await assert.rejects(backend(build,context()),/wheel filename/);
 }finally{await environment.dispose();}
});

test('legacy wheel hooks request genuine build tooling only for that invocation',async()=>{
 const environment=createPythonBuildEnvironment();const bootstraps:unknown[]=[];
 const backend=createPythonBuildBackend({environment,createExecutor:()=>({terminate(){},async run(start){
  bootstraps.push(start.packages?.bootstrapPackages);
  const request=await send(start,{op:'request'}) as any;
  await send(start,{op:'text',text:JSON.stringify(request.hook==='build_legacy_wheel'?'fixture-1-py3-none-any.whl':[])});await send(start,{op:'done'});return 0;
 }})});
 try{
  assert.equal(await backend({hook:'build_legacy_wheel',source:'/source',wheelDirectory:'/wheels'},context()),'fixture-1-py3-none-any.whl');
  await backend(request,context());assert.deepEqual(bootstraps,[['setuptools'],undefined]);
 }finally{await environment.dispose();}
});

test('download filename hooks validate metadata and bounded string results',async()=>{
 const environment=createPythonBuildEnvironment();let value:unknown='source.tar.gz',runs=0;
 const backend=createPythonBuildBackend({environment,createExecutor:()=>({terminate(){},async run(start){
  runs++;await send(start,{op:'text',text:JSON.stringify(value)});await send(start,{op:'done'});return 0;
 }})});
 const request={hook:'read_download_filename' as const,source:'https://source.test/download',responseUrl:'https://cdn.test/download',headers:[['content-type','application/zip']] as const};
 try{
  assert.equal(await backend(request,context()),value);
  value=[];await assert.rejects(backend(request,context()),/Invalid Python download filename/);
  value='too long';await assert.rejects(backend(request,{...context(),maxBytes:2}));
  const before=runs;
  await assert.rejects(backend({...request,headers:[['bad']] as any},context()),/Invalid Python download metadata/);
  assert.equal(runs,before);
 }finally{await environment.dispose();}
});

test('cancellation during program loading does not start a build interpreter',async()=>{
 const environment=createPythonBuildEnvironment();let started=0;
 const backend=createPythonBuildBackend({environment,createExecutor:()=>{started++;throw new Error('unexpected interpreter');}});
 const controller=new AbortController(),reason=new Error('cancelled before build');
 try{
  const running=backend(request,{...context(),signal:controller.signal});
  controller.abort(reason);
  await assert.rejects(running,error=>error===reason);
  assert.equal(started,0);
 }finally{await environment.dispose();}
});
