import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonLlmFragmentLoader} from './llm-fragment-loader.js';

function fixture(){
 let terminated=0;
 const loader=createPythonLlmFragmentLoader({plugins:['fixture'],createExecutor:()=>({terminate(){terminated++;},async run(start){
  start.onReady();
  const send=(value:any)=>start.host!.request({version:1,operation:'call',capability:'llm_fragments',value});
  assert.deepEqual(await send({op:'request'}),{prefix:'native',value:'input',plugins:['fixture']});
  await send({op:'begin',type:'text'});
  await send({op:'text',text:'hello'});
  if(!await send({op:'end'}))return 0;
  await send({op:'begin',type:'attachment',mimeType:'application/octet-stream',id:'binary'});
  await send({op:'bytes',bytes:[0,255]});
  await send({op:'end'});
  return 0;
 }})},'native');
 return {loader,terminated:()=>terminated};
}
test('native fragment loader yields text and binary sources and retires the session',async()=>{
 const f=fixture(),fs=new MemoryFileSystem(),values:any[]=[];
 for await(const fragment of f.loader('input',{fs,cwd:'/',signal:new AbortController().signal,maxBytes:1000})){
  const bytes:number[]=[];for await(const chunk of fragment.source.bytes)bytes.push(...chunk);
  values.push({type:fragment.type,bytes,...fragment.type==='attachment'?{mime:fragment.mimeType,id:fragment.id}:{}});
 }
 assert.deepEqual(values,[{type:'text',bytes:[104,101,108,108,111]},{type:'attachment',bytes:[0,255],mime:'application/octet-stream',id:'binary'}]);
 assert.equal(f.terminated(),1);assert.deepEqual(await fs.readdir('/'),[]);
});
test('early fragment return retires borrowed storage and interpreter',async()=>{
 const f=fixture(),fs=new MemoryFileSystem();
 for await(const fragment of f.loader('input',{fs,cwd:'/',signal:new AbortController().signal,maxBytes:1000})){assert.equal(fragment.type,'text');break;}
 assert.equal(f.terminated(),1);assert.deepEqual(await fs.readdir('/'),[]);
});

test('fragment admission failure retires every staged source',async()=>{
 const f=fixture(),fs=new MemoryFileSystem();
 await assert.rejects(async()=>{for await(const fragment of f.loader('input',{fs,cwd:'/',signal:new AbortController().signal,maxBytes:6}))for await(const ignored of fragment.source.bytes){assert.ok(ignored instanceof Uint8Array);}},/byte limit/);
 assert.equal(f.terminated(),1);assert.deepEqual(await fs.readdir('/'),[]);
});
test('cancellation between fragments retires the interpreter and borrowed output',async()=>{
 const f=fixture(),fs=new MemoryFileSystem(),controller=new AbortController(),reason=new Error('cancel fragments');
 await assert.rejects(async()=>{for await(const fragment of f.loader('input',{fs,cwd:'/',signal:controller.signal,maxBytes:1000})){assert.equal(fragment.type,'text');controller.abort(reason);}},error=>error===reason);
 assert.equal(f.terminated(),1);assert.deepEqual(await fs.readdir('/'),[]);
});

function protocolLoader(run:(send:(value:any)=>Promise<any>)=>Promise<void>){
 return createPythonLlmFragmentLoader({createExecutor:()=>({terminate(){},async run(start){
  start.onReady();await run(value=>start.host!.request({version:1,operation:'call',capability:'llm_fragments',value}));return 0;
 }})},'fixture');
}
test('fragment metadata does not reduce raw content admission',async()=>{
 const f=fixture(),fs=new MemoryFileSystem();let count=0;
 for await(const fragment of f.loader('input',{fs,cwd:'/',signal:new AbortController().signal,maxBytes:7})){
  for await(const chunk of fragment.source.bytes)count+=chunk.length;
 }
 assert.equal(count,7);assert.deepEqual(await fs.readdir('/'),[]);
});
test('URL fragments remain lazy and use only injected transport',async()=>{
 let requests=0;const fs=new MemoryFileSystem();
 const loader=protocolLoader(async send=>{await send({op:'begin',type:'attachment',mimeType:'text/plain',id:'url',url:'https://fixture.test/data'});await send({op:'end'});});
 for await(const fragment of loader('input',{fs,cwd:'/',signal:new AbortController().signal,maxBytes:2,capabilities:{fetch:async()=>{requests++;return new Response(new Uint8Array([1,2]));}}})){
  assert.equal(requests,0);const bytes=[];for await(const chunk of fragment.source.bytes)bytes.push(...chunk);assert.deepEqual(bytes,[1,2]);
 }
 assert.equal(requests,1);assert.deepEqual(await fs.readdir('/'),[]);
});
for(const message of [{op:'text',text:'bad'},{op:'begin',type:'attachment',id:1,mimeType:'text/plain'},{op:'invalid'}])test('invalid fragment protocol is rejected: '+JSON.stringify(message),async()=>{
 const fs=new MemoryFileSystem(),loader=protocolLoader(async send=>{await send(message);});
 await assert.rejects(async()=>{for await(const fragment of loader('input',{fs,cwd:'/',signal:new AbortController().signal,maxBytes:100})){assert.fail(JSON.stringify(fragment));}});
 assert.deepEqual(await fs.readdir('/'),[]);
});
test('native failure after staged content preserves its message and retires storage',async()=>{
 const fs=new MemoryFileSystem(),loader=protocolLoader(async send=>{await send({op:'begin',type:'text'});await send({op:'text',text:'partial'});await send({op:'error',message:'native loader failure'});});
 await assert.rejects(async()=>{for await(const fragment of loader('input',{fs,cwd:'/',signal:new AbortController().signal,maxBytes:100})){assert.fail(JSON.stringify(fragment));}},/native loader failure/);
 assert.deepEqual(await fs.readdir('/'),[]);
});

test('native fragment output reaches caller streams without becoming fragment data',async()=>{
 let output='',error='';
 const fs=new MemoryFileSystem();
 const loader=createPythonLlmFragmentLoader({createExecutor:()=>({terminate(){},async run(start){
  start.onReady();
  await start.dispatch({op:'stdout',args:[[111,117,116]]});
  await start.dispatch({op:'stderr',args:[[101,114,114]]});
  return 0;
 }})},'fixture');
 const context={fs,cwd:'/',signal:new AbortController().signal,maxBytes:0,
  stdout:{async write(bytes:Uint8Array){output+=new TextDecoder().decode(bytes);}},
  stderr:{async write(bytes:Uint8Array){error+=new TextDecoder().decode(bytes);}}};
 for await(const fragment of loader('',context))assert.fail(JSON.stringify(fragment));
 assert.equal(output,'out');assert.equal(error,'err');assert.deepEqual(await fs.readdir('/'),[]);
});
