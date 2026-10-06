import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createLlmTemplateStore,evaluateLlmTemplate} from 'safe-bash-command-llm';
import {createPythonLlmTemplateLoader} from './llm-template-loader.js';

const value={name:'native',prompt:'Hello $name: $input',system:'界',defaults:{name:'Ada'},options:{temperature:0.5},schema_object:{type:'object'},functions:'def tool(): return 1'};
function fixture(body=JSON.stringify(value)){
 let terminated=0;
 const loader=createPythonLlmTemplateLoader({plugins:['fixture'],createExecutor:()=>({terminate(){terminated++;},async run(start){
  start.onReady();const send=(value:any)=>start.host!.request({version:1,operation:'call',capability:'llm_templates',value});
  assert.deepEqual(await send({op:'request'}),{prefix:'native',value:'input',plugins:['fixture']});
  for(let offset=0;offset<body.length;offset+=5)await send({op:'text',text:body.slice(offset,offset+5)});
  await send({op:'done'});return 0;
 }})},'native');
 return {loader,terminated:()=>terminated};
}
test('native template loader preserves fields and untrusted function policy through the store',async()=>{
 const f=fixture(),fs=new MemoryFileSystem(),signal=new AbortController().signal;
 const store=createLlmTemplateStore({fs,cwd:'/',env:{},signal},{maxRemoteBytes:1000,maxBytes:1000,loaders:new Map([['native',f.loader]])});
 const loaded=await store.load('native:input');
 assert.deepEqual(loaded,value);assert.equal((loaded as any).functionsTrusted,false);
 assert.deepEqual(evaluateLlmTemplate(loaded,'question',{}),{prompt:'Hello Ada: question',system:'界'});
 assert.equal(f.terminated(),1);assert.deepEqual(await fs.readdir('/'),[]);
});
test('native template byte admission rejects output before retaining excess content',async()=>{
 const f=fixture(),fs=new MemoryFileSystem(),signal=new AbortController().signal;
 const store=createLlmTemplateStore({fs,cwd:'/',env:{},signal},{maxRemoteBytes:1000,maxBytes:10,loaders:new Map([['native',f.loader]])});
 await assert.rejects(store.load('native:input'),/byte limit/);
 assert.equal(f.terminated(),1);assert.deepEqual(await fs.readdir('/'),[]);
});
test('native template rejects malformed JSON and retires interpreter',async()=>{
 const f=fixture('{'),fs=new MemoryFileSystem(),signal=new AbortController().signal;
 const store=createLlmTemplateStore({fs,cwd:'/',env:{},signal},{maxRemoteBytes:1000,maxBytes:1000,loaders:new Map([['native',f.loader]])});
 await assert.rejects(store.load('native:input'));
 assert.equal(f.terminated(),1);assert.deepEqual(await fs.readdir('/'),[]);
});

test('native template cancellation preserves reason and awaits interpreter retirement',async()=>{
 let began!:()=>void,terminated=0;const started=new Promise<void>(resolve=>{began=resolve;});
 const controller=new AbortController(),fs=new MemoryFileSystem(),reason=new Error('cancel native template');
 const loader=createPythonLlmTemplateLoader({createExecutor:()=>({terminate(){terminated++;},async run(start){start.onReady();began();await new Promise<void>(resolve=>start.signal.addEventListener('abort',()=>resolve(),{once:true}));return 0;}})},'native');
 const pending=loader('input',controller.signal,{fs,cwd:'/',env:{},signal:controller.signal,maxBytes:1000});
 await started;controller.abort(reason);await assert.rejects(Promise.resolve(pending),error=>error===reason);
 assert.equal(terminated,1);assert.deepEqual(await fs.readdir('/'),[]);
});
for(const messages of [[],[{op:'error',message:'native failed'}],[{op:'text',text:'x'.repeat(8193)}],[{op:'done'},{op:'text',text:'ignored'}]])test('native template rejects incomplete or invalid protocol '+JSON.stringify(messages).slice(0,80),async()=>{
 let terminated=0;const fs=new MemoryFileSystem(),signal=new AbortController().signal;
 const loader=createPythonLlmTemplateLoader({createExecutor:()=>({terminate(){terminated++;},async run(start){start.onReady();for(const value of messages)await start.host!.request({version:1,operation:'call',capability:'llm_templates',value});return 0;}})},'native');
 await assert.rejects(Promise.resolve(loader('input',signal,{fs,cwd:'/',env:{},signal,maxBytes:1000})),error=>error instanceof Error&&(messages[0]?.op!=='error'||error.message==='native failed'));
 assert.equal(terminated,1);assert.deepEqual(await fs.readdir('/'),[]);
});

test('template store cancellation retains caller ownership of interpreter retirement',async()=>{
 let began!:()=>void,release!:()=>void,retired=false;
 const started=new Promise<void>(resolve=>{began=resolve;}),termination=new Promise<void>(resolve=>{release=resolve;});
 const cleanups:Array<()=>void|Promise<void>>=[],controller=new AbortController(),fs=new MemoryFileSystem();
 const loader=createPythonLlmTemplateLoader({createExecutor:()=>({async terminate(){await termination;retired=true;},async run(start){start.onReady();began();await new Promise<void>(resolve=>start.signal.addEventListener('abort',()=>resolve(),{once:true}));return 0;}})},'native');
 const store=createLlmTemplateStore({fs,cwd:'/',env:{},signal:controller.signal,registerCleanup:cleanup=>{cleanups.push(cleanup);}},{maxRemoteBytes:1000,maxBytes:1000,loaders:new Map([['native',loader]])});
 const pending=store.load('native:input');await started;controller.abort(new Error('stop template'));await assert.rejects(pending,/stop template/);
 try{assert.ok(cleanups.length>0);assert.equal(retired,false);}finally{release();}
 await Promise.all(cleanups.map(cleanup=>Promise.resolve().then(cleanup).catch(error=>{assert.match(String(error),/stop template/);})));assert.equal(retired,true);
});
