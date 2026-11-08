import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createOpenAiProvider, serializeOpenAiChatRequest} from './openai.js';
import {createLlmService} from './service.js';
import type {LlmInputSource} from './types.js';
import {createLlmCommand} from './command.js';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import type {CommandContext} from 'safe-bash-contracts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/audio-attachments-0.27.1.json', import.meta.url), 'utf8')) as {cases:{mimeType:string;bytes:number[];part:unknown}[]};
const signal = new AbortController().signal;
function source(bytes:Uint8Array):LlmInputSource {return {bytes:{async *[Symbol.asyncIterator](){for(const value of bytes)yield Uint8Array.of(value);}},async dispose(){}};}
async function read(body:AsyncIterable<Uint8Array>){let text='';for await(const chunk of body){assert.ok(chunk.length<=16384);text+=new TextDecoder().decode(chunk);}return JSON.parse(text);}
type Wire = {messages:{content:unknown[]}[]};

test('buffered and source OpenAI audio parts match pinned LLM WAV/MP3 fixtures',async()=>{
 for(const row of fixture.cases){
  const bytes=Uint8Array.from(row.bytes);
  const request={model:'audio',options:{},signal,stream:false,prompt:source(new TextEncoder().encode('listen')),attachments:[{mimeType:row.mimeType,source:source(bytes)}]};
  const encoded=await read(serializeOpenAiChatRequest(request,Infinity));
  assert.deepEqual(encoded.messages[0].content[1],row.part);
  let wire:unknown;
  const service=createLlmService({providers:[createOpenAiProvider({apiKey:'fixture',models:[{id:'audio',endpoint:'chat',attachmentTypes:['audio/wav','audio/mpeg']}],transport:async request=>{wire=await read(request.body!);return {status:200,statusText:'OK',headers:[],body:{async *[Symbol.asyncIterator](){yield new TextEncoder().encode('{"choices":[{"message":{"content":"heard"}}]}');}},async dispose(){}};}})]});
  for await(const value of service.complete({model:'audio',prompt:'listen',options:{},signal,stream:false,attachments:[{mimeType:row.mimeType,bytes}]}))void value;
  assert.deepEqual(wire,encoded);
 }
});

test('mixed caller messages encode audio and image sources in order and dispose leases',async()=>{
 let disposed=0,wire:Wire|undefined;
 const input=(bytes:Uint8Array)=>({...source(bytes),async dispose(){disposed++;}});
 const service=createLlmService({providers:[createOpenAiProvider({apiKey:'fixture',models:[{id:'mixed',endpoint:'chat',attachmentTypes:['audio/wav','audio/mpeg','image/png']}],transport:async request=>{wire=await read(request.body!);return {status:200,statusText:'OK',headers:[],body:{async *[Symbol.asyncIterator](){yield new TextEncoder().encode('{"choices":[{"message":{"content":"ok"}}]}');}},async dispose(){}};}})]});
 for await(const event of service.streamSources!({model:'mixed',prompt:input(Uint8Array.of(110)),messages:[{role:'user',content:input(Uint8Array.of(112)),attachments:[{mimeType:'audio/wav',source:input(Uint8Array.of(1))}]}],attachments:[{mimeType:'image/png',url:'https://example.test/image'},{mimeType:'audio/mpeg',source:input(Uint8Array.of(2))}],options:{},signal,stream:false}))void event;
 assert.deepEqual(wire!.messages[0]!.content[1],{type:'input_audio',input_audio:{data:'AQ==',format:'wav'}});
 assert.deepEqual(wire!.messages[1]!.content.slice(1),[{type:'image_url',image_url:{url:'https://example.test/image'}},{type:'input_audio',input_audio:{data:'Ag==',format:'mp3'}}]);
 assert.equal(disposed,4);
});

test('CLI retained audio files use source transport and obey model MIME admission',async()=>{
 const fs=new MemoryFileSystem();await fs.writeFile('/sample.wav',Uint8Array.of(0,1,255));
 let calls=0;const provider=createOpenAiProvider({apiKey:'fixture',models:[{id:'audio',endpoint:'chat',attachmentTypes:['audio/wav']},{id:'text',endpoint:'chat'}],transport:async request=>{calls++;const wire=await read(request.body!);assert.deepEqual(wire.messages[0].content[1],fixture.cases[3]!.part);return {status:200,statusText:'OK',headers:[],body:{async *[Symbol.asyncIterator](){yield new TextEncoder().encode('{"choices":[{"message":{"content":"heard"}}]}');}},async dispose(){}};}});
 for(const model of ['audio','text']){
  const errors:Uint8Array[]=[];
  const result=await createLlmCommand({providers:[provider]}).execute({command:'llm',args:['listen','-m',model,'--no-stream','--at','/sample.wav','audio/wav'],fs,cwd:'/',env:{},signal,stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(){}},stderr:{async write(bytes){errors.push(bytes.slice());}}} as CommandContext);
  assert.equal(result.exitCode,model==='audio'?0:1,Buffer.concat(errors).toString());
 }
 assert.equal(calls,1);
});

test('audio serialization stays bounded and retires borrowed input on wire overflow',async()=>{
 let returned=0,pulls=0,peak=0;
 const audio:LlmInputSource={async dispose(){assert.fail('serializer must not dispose borrowed leases');},bytes:{async *[Symbol.asyncIterator](){try{for(let index=0;index<4096;index++){pulls++;yield new Uint8Array(4096);}}finally{returned++;}}}};
 await assert.rejects(async()=>{for await(const chunk of serializeOpenAiChatRequest({model:'audio',prompt:source(new Uint8Array()),attachments:[{mimeType:'audio/mpeg',source:audio}],options:{},signal},20000))peak=Math.max(peak,chunk.length);},/byte limit/);
 assert.ok(peak<=16384);assert.ok(pulls<8);assert.equal(returned,1);
});

test('audio source cancellation releases a pending reader without buffering',async()=>{
 const controller=new AbortController();let returned=0;
 let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
 const audio:LlmInputSource={async dispose(){},bytes:{[Symbol.asyncIterator](){return {next(){started();return new Promise<IteratorResult<Uint8Array>>(()=>{});},async return(){returned++;return {done:true,value:undefined};}};}}};
 const consuming=(async()=>{for await(const bytes of serializeOpenAiChatRequest({model:'audio',prompt:source(new Uint8Array()),attachments:[{mimeType:'audio/wav',source:audio}],options:{},signal:controller.signal},Infinity))void bytes;})();
 await ready;controller.abort(new Error('stop audio'));await assert.rejects(consuming,/stop audio/);assert.equal(returned,1);
});
