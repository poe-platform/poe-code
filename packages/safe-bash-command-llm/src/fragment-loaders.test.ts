import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {toByteSource} from 'safe-bash-contracts';
import {createLlmCommand} from './command.js';
import type {LlmSourceRequest} from './types.js';
import {createLlmFragmentLoaders,getLlmFragmentPrefix,loadLlmPluginFragments,type LlmFragmentLoader,type LlmLoadedFragment} from './fragment-loaders.js';

for(const streamed of [false,true])for(const system of [false,true])test(`reference mixed loader, source=${streamed}, system=${system}`,async()=>{
 const fs=new MemoryFileSystem();await fs.writeFile('/local.png',Uint8Array.of(7));
 let calls=0,disposed=0,error='';
 const mixed:LlmFragmentLoader=async function*(value){
  for(const item of [{type:'text',value:'first\r\n'+value},{type:'attachment',value:'abc'},{type:'text',value:'last'}]as const){
   const source={bytes:toByteSource(item.value),async dispose(){disposed++;}};
   if(item.type==='text')yield {type:'text',source};else yield {type:'attachment',source,mimeType:'image/png'};
  }
 };
 const verify=(prompt:string,images:readonly Uint8Array[])=>{calls++;assert.equal(prompt,'first\r\nvalue:tail\nlast\nquestion');assert.deepEqual(images.map(bytes=>Array.from(bytes)),[[7],[97,98,99]]);};
 const command=createLlmCommand({fragmentLoaders:new Map([['mixed',mixed]]),defaultModel:'fixture',providers:[{name:'fixture',models:[{id:'fixture',attachmentTypes:['image/png']}],async *complete(request){verify(request.prompt,request.attachments.map(value=>value.bytes!));yield 'ok';},...(streamed?{async *completeSources(request:LlmSourceRequest){let prompt='';for await(const bytes of request.prompt.bytes)prompt+=new TextDecoder().decode(bytes);const images:Uint8Array[]=[];for(const attachment of request.attachments){for await(const bytes of attachment.source!.bytes)images.push(bytes);}verify(prompt,images);yield 'ok';}}:{})}]});
 const result=await command.execute({command:'llm',args:['-a','/local.png',system?'--sf':'-f','mixed:value:tail','question'],fs,cwd:'/',env:{},signal:new AbortController().signal,stdin:toByteSource(''),stdout:{async write(){}},stderr:{async write(bytes){error+=new TextDecoder().decode(bytes);}}});
 assert.equal(result.exitCode,system?1:0,error);assert.equal(calls,system?0:1);assert.equal(disposed,system?2:3);
 if(system)assert.equal(error,'Error: Could not load fragment mixed:value:tail: Fragment loader mixed returned a disallowed attachment\n');
 assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['local.png']);
});

test('reference fragment loader discovery uses registered descriptions',async()=>{
 const loader:LlmFragmentLoader=Object.assign(async function*(){},{description:'Return text and image content.'});
 const command=createLlmCommand({fragmentLoaders:new Map([['mixed',loader],['empty',async function*(){}]])});
 let stdout='',stderr='';
 const result=await command.execute({command:'llm',args:['fragments','loaders'],fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,stdin:toByteSource(''),stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}});
 assert.equal(result.exitCode,0,stderr);assert.equal(stdout,'mixed:\n  Return text and image content.\n\nempty:\n  Undocumented\n');
});

const loaderContext=(signal=new AbortController().signal)=>({fs:new MemoryFileSystem(),cwd:'/',signal,maxBytes:1024});

test('plugin prefix grammar and collision suffixes preserve reference registration order',()=>{
 const loader:LlmFragmentLoader=async function*(){};
 assert.deepEqual([...createLlmFragmentLoaders([['a',loader],['a_1',loader],['a',loader],['a',loader]]).keys()],['a','a_1','a_2','a_3']);
 for(const value of ['a:b:c','0-a_:x'])assert.equal(getLlmFragmentPrefix(value),value.slice(0,value.indexOf(':')));
 for(const value of [':x','a.b:x','a/b:x','é:x','file'])assert.equal(getLlmFragmentPrefix(value),undefined);
});

test('SDK loader disposes borrowed sources once on early return',async()=>{
 let disposed=0,returned=0;
 const loader:LlmFragmentLoader=async function*(){try{yield {type:'text',source:{bytes:toByteSource('value'),async dispose(){disposed++;}}};}finally{returned++;}};
 for await(const item of loadLlmPluginFragments('a:value',new Map([['a',loader]]),loaderContext())){await item.source.dispose();break;}
 assert.equal(disposed,1);assert.equal(returned,1);
});

test('SDK loader cancellation retires late acquired sources',async()=>{
 const controller=new AbortController();let resolve!:(result:IteratorResult<LlmLoadedFragment>)=>void,started!:()=>void;
 const ready=new Promise<void>(done=>{started=done;});let disposed=0,returned=0;
 const loader:LlmFragmentLoader=()=>({[Symbol.asyncIterator](){return {next(){started();return new Promise(done=>{resolve=done;});},async return(){returned++;return {done:true,value:undefined};}};}});
 const iterator=loadLlmPluginFragments('a:value',new Map([['a',loader]]),loaderContext(controller.signal));
 const next=iterator.next();await ready;controller.abort(new Error('cancelled'));
 await assert.rejects(next,/cancelled/);
 resolve({done:false,value:{type:'text',source:{bytes:toByteSource('late'),async dispose(){disposed++;}}}});
 await new Promise<void>(done=>setImmediate(done));
 assert.equal(disposed,1);assert.equal(returned,1);
});

test('SDK loader cancellation interrupts a stalled iterator return',{timeout:1000},async()=>{
 const controller=new AbortController();let started!:()=>void;
 const ready=new Promise<void>(done=>{started=done;});
 const loader:LlmFragmentLoader=()=>({[Symbol.asyncIterator](){return {async next(){return {done:false,value:{type:'text',source:{bytes:toByteSource('value'),async dispose(){}}}} as const;},return(){started();return new Promise<IteratorResult<LlmLoadedFragment>>(()=>{});}};}});
 const iterator=loadLlmPluginFragments('a:value',new Map([['a',loader]]),loaderContext(controller.signal));
 await iterator.next();const closing=iterator.return(undefined);await ready;controller.abort(new Error('cancelled'));
 await assert.rejects(closing,/cancelled/);
});

for(const streamed of [false,true])for(const failure of ['none','mime','loader','total']as const)test(`plugin attachment admission and cleanup: ${failure}, source=${streamed}`,async()=>{
 const fs=new MemoryFileSystem();let disposed=0,reads=0,calls=0,stderr='';
 const loader:LlmFragmentLoader=async function*(){
  yield {type:'attachment',mimeType:failure==='mime'?'image/unsupported':'image/png',source:{bytes:{async *[Symbol.asyncIterator](){for(let i=0;i<16;i++){reads++;yield new Uint8Array(1024);}}},async dispose(){disposed++;}}};
  if(failure==='loader')throw new Error('fixture loader failed');
 };
 const command=createLlmCommand({fragmentLoaders:new Map([['a',loader]]),limits:{maxBufferedInputBytes:4096,maxInputBytes:failure==='total'?8192:32768},defaultModel:'fixture',providers:[{name:'fixture',models:[{id:'fixture',attachmentTypes:['image/png']}],async *complete(){calls++;yield 'ok';},...(streamed?{async *completeSources(request:LlmSourceRequest){calls++;let size=0;for await(const bytes of request.attachments[0]!.source!.bytes)size+=bytes.length;assert.equal(size,16384);yield 'ok';}}:{})}]});
 const result=await command.execute({command:'llm',args:['-f','a:value','question'],fs,cwd:'/',env:{},signal:new AbortController().signal,stdin:toByteSource(''),stdout:{async write(){}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}});
 const success=streamed&&failure==='none';
 assert.equal(result.exitCode,success?0:1,stderr);assert.equal(calls,success?1:0);assert.equal(disposed,1);
 if(failure==='mime')assert.equal(reads,0);
 if(failure==='loader'&&streamed)assert.match(stderr,/fixture loader failed/);
 assert.deepEqual(await fs.readdir('/'),[]);
});

for(const [args,exitCode,expected]of [
 [['fragments','loaders'],0,'No fragment loaders found\n'],
 [['fragments','loaders','--help'],0,'Usage: llm fragments loaders [OPTIONS]\n\n  Show fragment loaders registered by plugins\n\nOptions:\n  -h, --help  Show this message and exit.\n'],
 [['fragments','loaders','extra'],2,`Usage: llm fragments loaders [OPTIONS]\nTry 'llm fragments loaders -h' for help.\n\nError: Got unexpected extra argument (extra)\n`],
]as const)test(`reference loader discovery ${args.join(' ')}`,async()=>{
 let stdout='',stderr='';
 const result=await createLlmCommand().execute({command:'llm',args:[...args],fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,stdin:{[Symbol.asyncIterator](){throw new Error('must not read stdin');}},stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}});
 assert.equal(result.exitCode,exitCode);assert.equal(exitCode?stderr:stdout,expected);
});

for(const limit of [Infinity,1,14])test(`CLI fragment output streams respect limit ${limit}`,async()=>{
 let output='',error='';
 const loader:LlmFragmentLoader=async function*(_value,context){
  await context.stdout?.write(new TextEncoder().encode('plugin output\n'));
  await context.stderr?.write(new TextEncoder().encode('plugin diagnostic\n'));
  yield {type:'text',source:{bytes:toByteSource('fragment'),async dispose(){}}};
 };
 const command=createLlmCommand({fragmentLoaders:new Map([['native',loader]]),limits:{maxOutputBytes:limit},defaultModel:'fixture',providers:[{name:'fixture',models:[{id:'fixture'}],async *complete(){yield 'response';}}]});
 const result=await command.execute({command:'llm',args:['-f','native:input','prompt'],fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,stdin:toByteSource(''),stdout:{async write(bytes){output+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){error+=new TextDecoder().decode(bytes);}}});
 if(limit===Infinity){assert.equal(result.exitCode,0,error);assert.equal(output,'plugin output\nresponse\n');assert.equal(error,'plugin diagnostic\n');}
 else{assert.equal(result.exitCode,1);assert.equal(output,limit===14?'plugin output\n':'');assert.match(error,/output byte limit exceeded/);}
});
