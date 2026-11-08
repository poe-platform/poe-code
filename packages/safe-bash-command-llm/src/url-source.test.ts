import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import * as llm from './index.js';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import type {CommandContext} from 'safe-bash-contracts';

test('URL input leases stream owned bounded chunks and charge bytes before exposure',async()=>{
 const bytes=new Uint8Array(32769).fill(7);let calls=0,admitted=0;
 const input=llm.createLlmUrlSource({url:'https://example.test/audio',signal:new AbortController().signal,maxBytes:bytes.length,admitBytes(size){admitted+=size;},fetch:async(url,init)=>{calls++;assert.equal(url,'https://example.test/audio');assert.equal(init?.method,'GET');assert.equal(init?.redirect,'manual');return new Response(new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}}));}});
 assert.equal(calls,0);let total=0;
 for await(const chunk of input.bytes){assert.ok(chunk.length<=16384);assert.equal(chunk[0],7);assert.ok(admitted>=total+chunk.length);total+=chunk.length;chunk.fill(9);}
 assert.equal(total,bytes.length);assert.equal(bytes[0],7);assert.equal(calls,1);await input.dispose();
});

test('URL input byte overflow and rejected admission cancel the response',async()=>{
 for(const admissionFails of [false,true]){
  let cancelled=0;
  const input=llm.createLlmUrlSource({url:'https://example.test/audio',signal:new AbortController().signal,maxBytes:admissionFails?10:2,admitBytes(){if(admissionFails)throw Error('parent input cap');},fetch:async()=>new Response(new ReadableStream({start(controller){controller.enqueue(Uint8Array.of(1,2,3));},cancel(){cancelled++;}}))});
  await assert.rejects(async()=>{for await(const chunk of input.bytes)assert.fail(`unexpected ${chunk.length}`);},admissionFails?/parent input cap/:/byte limit/);assert.equal(cancelled,1);
 }
});

test('URL source cancellation releases late responses and pending reads',async()=>{
 for(const late of [true,false]){
  const controller=new AbortController();let cancelled=0,started!:()=>void,resolveResponse!:(response:Response)=>void;
  const ready=new Promise<void>(resolve=>{started=resolve;});
  const response=()=>new Response(new ReadableStream({pull(){if(!late)started();},cancel(){cancelled++;}}));
  const input=llm.createLlmUrlSource({url:'https://example.test/audio',signal:controller.signal,fetch:async()=>{if(!late)return response();started();return new Promise<Response>(resolve=>{resolveResponse=resolve;});}});
  const consuming=(async()=>{for await(const chunk of input.bytes)void chunk;})();
  await ready;controller.abort(new Error('stop remote input'));await assert.rejects(consuming,/stop remote input/);
  if(late)resolveResponse(response());await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(cancelled,1);await input.dispose();
 }
});

test('URL source disposal before consumption never fetches and cannot be reopened',async()=>{
 const input=llm.createLlmUrlSource({url:'https://example.test/audio',signal:new AbortController().signal,fetch:async()=>assert.fail('unexpected fetch')});
 await input.dispose();await assert.rejects(async()=>{for await(const bytes of input.bytes)void bytes;},/closed/);
});

test('URL source rejects redirects and HTTP failures without reading bodies',async()=>{
 for(const status of [302,404,500]){
  let cancelled=0;
  const input=llm.createLlmUrlSource({url:'https://example.test/audio',signal:new AbortController().signal,fetch:async()=>new Response(new ReadableStream({cancel(){cancelled++;}},{highWaterMark:0}),{status,headers:{location:'https://elsewhere.test/audio'}})});
  await assert.rejects(async()=>{for await(const bytes of input.bytes)void bytes;},{message:`Attachment URL returned HTTP ${status}`});assert.equal(cancelled,1);
 }
});

test('disposal interrupts an active read and retires the single-use lease',async()=>{
 let started!:()=>void,cancelled=0;const ready=new Promise<void>(resolve=>{started=resolve;});
 const input=llm.createLlmUrlSource({url:'https://example.test/audio',signal:new AbortController().signal,fetch:async()=>new Response(new ReadableStream({pull(){started();},cancel(){cancelled++;}}))});
 const reading=(async()=>{for await(const bytes of input.bytes)void bytes;})();
 await ready;await input.dispose();await assert.rejects(reading,/closed/);assert.equal(cancelled,1);
 await assert.rejects(async()=>{for await(const bytes of input.bytes)void bytes;},/closed/);
});

test('CLI remote sources charge aggregate total, buffered and parent input budgets',async()=>{
 for(const scenario of ['source','buffered','total','parent']as const){
  let error='',cancelled=0;
  const consume=async(attachments:readonly llm.LlmSourceAttachment[])=>{for(const attachment of attachments)for await(const bytes of attachment.source!.bytes)void bytes;};
  const provider:llm.LlmProvider={name:'fixture',models:[{id:'audio',attachmentTypes:['audio/wav']}],async *complete(request){assert.equal(request.attachments[0]!.bytes!.length,2048);yield 'ok';},...(scenario==='buffered'?{}:{async *completeSources(request:llm.LlmSourceRequest){await consume(request.attachments);yield 'ok';}})};
  const result=await llm.createLlmCommand({providers:[provider],defaultModel:'audio',limits:{maxInputBytes:scenario==='total'?3000:10000,maxBufferedInputBytes:512}}).execute({command:'llm',args:['listen','--at','https://example.test/one','audio/wav','--at','https://example.test/two','audio/wav'],fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(){}},stderr:{async write(bytes){error+=new TextDecoder().decode(bytes);}},...(scenario==='parent'?{inputBudget:{maxBytes:3000,check(bytes:number){if(bytes>3000)throw Error('parent input exceeded');}}}:{}),capabilities:{fetch:async()=>{let sent=false;return new Response(new ReadableStream({pull(controller){if(sent)controller.close();else{sent=true;controller.enqueue(new Uint8Array(2048));}},cancel(){cancelled++;}},{highWaterMark:0}));}}} as CommandContext);
  assert.equal(result.exitCode,scenario==='source'?0:1,error);
  if(scenario==='buffered')assert.ok(cancelled>0);
  if(scenario!=='source')assert.ok(error.includes('input')||error.includes('limit'),error);
 }
});

test('CLI URL audio fetches native bytes using injected capability and preserves input admission',async()=>{
 for(const typed of [true,false]){
  const methods:string[]=[];let calls=0;
  const provider=llm.createOpenAiProvider({apiKey:'fixture',models:[{id:'audio',endpoint:'chat',attachmentTypes:['audio/wav']}],transport:async request=>{calls++;let text='';for await(const bytes of request.body!)text+=new TextDecoder().decode(bytes);assert.deepEqual(JSON.parse(text).messages[0].content[1],{type:'input_audio',input_audio:{data:'AAH/',format:'wav'}});return {status:200,statusText:'OK',headers:[],body:{async *[Symbol.asyncIterator](){yield new TextEncoder().encode('{"choices":[{"message":{"content":"heard"}}]}');}},async dispose(){}};}});
  let error='';const result=await llm.createLlmCommand({providers:[provider],defaultModel:'audio'}).execute({command:'llm',args:['listen','--no-stream',...(typed?['--at','https://example.test/audio','audio/wav']:['-a','https://example.test/audio'])],fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(){}},stderr:{async write(bytes){error+=new TextDecoder().decode(bytes);}},capabilities:{fetch:async(_url,init)=>{methods.push(init?.method??'');return new Response(init?.method==='HEAD'?null:Uint8Array.of(0,1,255),{headers:{'content-type':'audio/wav'}});}}} as CommandContext);
  assert.equal(result.exitCode,0,error);assert.equal(calls,1);assert.deepEqual(methods,typed?['GET']:['HEAD','GET']);
 }
});

test('SDK remote input sources reproduce pinned URL audio provider parts',async()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/url-audio-0.27.1.json',import.meta.url),'utf8'))as{cases:{url:string;mimeType:string;bytes:number[];part:unknown}[]};
 for(const row of fixture.cases){
  const signal=new AbortController().signal;let calls=0;
  const source=llm.createLlmUrlSource({url:row.url,signal,fetch:async(url,init)=>{calls++;assert.equal(url,row.url);assert.equal(init?.method,'GET');return new Response(Uint8Array.from(row.bytes));}});
  let text='';for await(const bytes of llm.serializeOpenAiChatRequest({model:'audio',prompt:{bytes:{async *[Symbol.asyncIterator](){}},async dispose(){}},attachments:[{mimeType:row.mimeType,source}],options:{},signal},Infinity))text+=new TextDecoder().decode(bytes);
  assert.deepEqual(JSON.parse(text).messages[0].content,[row.part]);assert.equal(calls,1);await source.dispose();
 }
});
