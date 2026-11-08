import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createHash} from 'node:crypto';
import * as llm from './index.js';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import type {CommandContext} from 'safe-bash-contracts';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/pdf-attachments-0.27.1.json',import.meta.url),'utf8')) as {cases:{kind:'content'|'path'|'url';bytes:number[];url?:string;id?:string;part:unknown}[]};
const signal=new AbortController().signal;
function source(bytes:Uint8Array):llm.LlmInputSource{return {bytes:{async *[Symbol.asyncIterator](){for(let offset=0;offset<bytes.length;offset+=3)yield bytes.slice(offset,offset+3);}},async dispose(){}};}
function provider(check:(part:unknown)=>void){return llm.createOpenAiProvider({apiKey:'fixture',models:[{id:'pdf',endpoint:'chat',attachmentTypes:['application/pdf']}],transport:async request=>{
 let text='';for await(const bytes of request.body!){assert.ok(bytes.length<=16384);text+=new TextDecoder().decode(bytes);}check(JSON.parse(text).messages[0].content[1]);
 return {status:200,statusText:'OK',headers:[],body:{async *[Symbol.asyncIterator](){yield new TextEncoder().encode('{"choices":[{"message":{"content":"PDF received."}}]}');}},async dispose(){}};
}});}

test('PDF SDK parts match pinned content/path/URL and explicit attachment IDs',async()=>{
 for(const row of fixture.cases){
  let calls=0;const service=llm.createLlmService({providers:[provider(part=>{calls++;assert.deepEqual(part,row.part);})]});
  const control={model:'pdf',options:{},signal,stream:false};
  if(row.kind==='content'){
   for await(const value of service.complete({...control,prompt:'read',attachments:[{mimeType:'application/pdf',bytes:Uint8Array.from(row.bytes),...(row.id===undefined?{}:{id:row.id})}]}))void value;
  }else{
   const attachment={mimeType:'application/pdf',source:row.kind==='url'?llm.createLlmUrlSource({url:row.url!,signal,fetch:async()=>new Response(Uint8Array.from(row.bytes))}):source(Uint8Array.from(row.bytes)),...(row.kind==='url'?{id:await llm.getLlmAttachmentUrlId(row.url!,signal)}:{})};
   for await(const event of service.streamSources!({...control,prompt:source(new TextEncoder().encode('read')),attachments:[attachment]}))void event;
  }
  assert.equal(calls,1);
 }
});

test('PDF CLI local paths and URLs preserve reference filenames and bytes',async()=>{
 for(const row of fixture.cases.filter(row=>row.kind!=='content')){
  const fs=new MemoryFileSystem();await fs.writeFile('/document.pdf',Uint8Array.from(row.bytes));let error='',calls=0;
  const result=await llm.createLlmCommand({providers:[provider(part=>{calls++;assert.deepEqual(part,row.part);})],defaultModel:'pdf'}).execute({command:'llm',args:['read','--no-stream','--at',row.kind==='url'?row.url!:'/document.pdf','application/pdf'],fs,cwd:'/',env:{},signal,stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(){}},stderr:{async write(bytes){error+=new TextDecoder().decode(bytes);}},capabilities:{fetch:async()=>new Response(Uint8Array.from(row.bytes))}} as CommandContext);
  assert.equal(result.exitCode,0,error);assert.equal(calls,1);
 }
});

test('URL attachment IDs match pinned Python JSON and SHA256 spelling',async()=>{
 const ids=JSON.parse(readFileSync(new URL('./fixtures/attachment-url-ids-0.27.1.json',import.meta.url),'utf8'))as{cases:{url:string|null;id:string}[]};
 for(const row of ids.cases)assert.equal(await llm.getLlmAttachmentUrlId(row.url,signal),row.id);
});

test('PDF serializer hashes a single pass while emitting bounded chunks',async()=>{
 const bytes=Uint8Array.from({length:131073},(_,index)=>index%251);let acquisitions=0,disposed=0;
 const input:llm.LlmInputSource={async dispose(){disposed++;},bytes:{async *[Symbol.asyncIterator](){assert.equal(++acquisitions,1);yield bytes;}}};
 let text='';for await(const part of llm.serializeOpenAiChatRequest({model:'pdf',prompt:source(new Uint8Array()),attachments:[{mimeType:'application/pdf',source:input}],options:{},signal},Infinity)){assert.ok(part.length<=16384);text+=new TextDecoder().decode(part);}
 const [part]=JSON.parse(text).messages[0].content;
 assert.equal(part.file.filename,createHash('sha256').update(bytes).digest('hex')+'.pdf');assert.equal(part.file.file_data,'data:application/pdf;base64,'+Buffer.from(bytes).toString('base64'));
 assert.equal(disposed,0);assert.equal(acquisitions,1);
});

test('PDF caller messages and current attachments retain explicit source identities',async()=>{
 const row=fixture.cases.find(row=>row.id!==undefined)!;
 let text='';for await(const bytes of llm.serializeOpenAiChatRequest({model:'pdf',prompt:source(new Uint8Array()),messages:[{role:'user',content:source(new Uint8Array()),attachments:[{mimeType:'application/pdf',id:row.id!,source:source(Uint8Array.from(row.bytes))}]}],attachments:[{mimeType:'application/pdf',id:row.id!,source:source(Uint8Array.from(row.bytes))}],options:{},signal},Infinity))text+=new TextDecoder().decode(bytes);
 for(const message of JSON.parse(text).messages)assert.deepEqual(message.content,[row.part]);
});

test('PDF wire overflow retires input and shared service releases its leases',async()=>{
 let pulls=0,returned=0,disposed=0;
 const pdf:llm.LlmInputSource={async dispose(){disposed++;},bytes:{async *[Symbol.asyncIterator](){try{for(let index=0;index<1000;index++){pulls++;yield new Uint8Array(4096);}}finally{returned++;}}}};
 const service=llm.createLlmService({providers:[llm.createOpenAiProvider({apiKey:'fixture',models:[{id:'pdf',endpoint:'chat',attachmentTypes:['application/pdf']}],limits:{maxRequestBytes:20000},transport:async request=>{for await(const bytes of request.body!)void bytes;return assert.fail('must not complete overflowing request');}})]});
 await assert.rejects(async()=>{for await(const event of service.streamSources!({model:'pdf',prompt:source(new Uint8Array()),attachments:[{mimeType:'application/pdf',source:pdf}],options:{},signal}))void event;},/byte limit/);
 assert.ok(pulls<8);assert.equal(returned,1);assert.equal(disposed,1);
});

test('PDF cancellation retires a pending source without waiting for its payload',async()=>{
 const controller=new AbortController();let ready!:()=>void,returned=0;const started=new Promise<void>(resolve=>{ready=resolve;});
 const input:llm.LlmInputSource={async dispose(){},bytes:{[Symbol.asyncIterator](){return {next(){ready();return new Promise<IteratorResult<Uint8Array>>(()=>{});},async return(){returned++;return {done:true,value:undefined};}};}}};
 const reading=(async()=>{for await(const bytes of llm.serializeOpenAiChatRequest({model:'pdf',prompt:source(new Uint8Array()),attachments:[{mimeType:'application/pdf',source:input}],options:{},signal:controller.signal},Infinity))void bytes;})();
 await started;controller.abort(new Error('stop PDF'));await assert.rejects(reading,/stop PDF/);assert.equal(returned,1);
});
