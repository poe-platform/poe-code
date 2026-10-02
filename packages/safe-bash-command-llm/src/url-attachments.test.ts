import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createLlmCommand} from './command.js';
import {createLlmService} from './service.js';
import {createOpenAiProvider} from './openai.js';
import type {CommandContext} from 'safe-bash-contracts';

async function invoke(args:string[],fetch?:typeof globalThis.fetch){
 let calls=0;const bodies:unknown[]=[],errors:Uint8Array[]=[];
 const provider=createOpenAiProvider({apiKey:'fixture-key',models:[{id:'vision',endpoint:'chat',attachmentTypes:['image/*']}],transport:async request=>{
  calls++;let body='';for await(const bytes of request.body!)body+=new TextDecoder().decode(bytes);bodies.push(JSON.parse(body));
  return {status:200,statusText:'OK',headers:[],body:{async *[Symbol.asyncIterator](){yield new TextEncoder().encode('{"choices":[{"message":{"content":"image described"}}]}');}},async dispose(){}};
 }});
 const result=await createLlmCommand({providers:[provider],defaultModel:'vision'}).execute({command:'llm',args:['--no-stream',...args],fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(){}},stderr:{async write(bytes){errors.push(bytes.slice());}},...(fetch?{capabilities:{fetch}}:{})} as CommandContext);
 return {code:result.exitCode,calls,bodies,stderr:Buffer.concat(errors).toString()};
}
test('typed image URLs pass through to OpenAI without fetching or filesystem reads',async()=>{
 const result=await invoke(['describe','--at','https://example.test/image.png?size=2','image/png'],async()=>{throw Error('must not fetch typed URL');});
 assert.equal(result.code,0,result.stderr);assert.equal(result.calls,1);
 assert.deepEqual((result.bodies[0] as {messages:unknown[]}).messages,[{role:'user',content:[{type:'text',text:'describe'},{type:'image_url',image_url:{url:'https://example.test/image.png?size=2'}}]}]);
});
test('untyped image URLs use injected HEAD metadata and discard response bodies',async()=>{
 let calls=0,cancelled=0;
 const result=await invoke(['describe','-a','https://example.test/image'],async(url,init)=>{
  calls++;assert.equal(url,'https://example.test/image');assert.equal(init?.method,'HEAD');assert.equal(init?.redirect,'manual');
  return new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-type':'image/png'}});
 });
 assert.equal(result.code,0,result.stderr);assert.equal(calls,1);assert.equal(cancelled,1);
});
test('buffered SDK image URLs retain their URL on the provider wire',async()=>{
 let body='';
 const service=createLlmService({providers:[createOpenAiProvider({apiKey:'fixture-key',models:[{id:'vision',endpoint:'chat',attachmentTypes:['image/*']}],transport:async request=>{for await(const bytes of request.body!)body+=new TextDecoder().decode(bytes);return {status:200,statusText:'OK',headers:[],body:{async *[Symbol.asyncIterator](){yield new TextEncoder().encode('{"choices":[{"message":{"content":"ok"}}]}');}},async dispose(){}};}})]});
 for await(const chunk of service.complete({model:'vision',prompt:'describe',attachments:[{mimeType:'image/png',url:'https://example.test/image.png'}],options:{},signal:new AbortController().signal,stream:false}))void chunk;
 assert.equal(JSON.parse(body).messages[0].content[1].image_url.url,'https://example.test/image.png');
});

test('HEAD errors, redirects and missing or unsupported MIME types stop before provider invocation',async()=>{
 for(const response of [new Response(null,{status:404}),new Response(null,{status:302,headers:{location:'https://other.test/image'}}),new Response(null),new Response(null,{headers:{'content-type':'application/pdf'}})]){
  const result=await invoke(['describe','-a','https://example.test/image'],async()=>response);
  assert.equal(result.code,1);assert.equal(result.calls,0);assert.ok(result.stderr.length>0);
 }
});
test('URL validation and unsupported models fail before any provider call',async()=>{
 let called=false;
 const service=createLlmService({providers:[{name:'fixture',models:[{id:'local',attachmentTypes:['image/*']},{id:'urls',attachmentTypes:['image/*'],attachmentUrls:true}],async *complete(){called=true;yield 'wrong';}}]});
 for(const [model,url]of [['local','https://example.test/x'],['urls','file:///private/image'],['urls','https://user:password@example.test/x']])assert.throws(()=>service.complete({model:model!,prompt:'describe',attachments:[{mimeType:'image/png',url:url!}],options:{},signal:new AbortController().signal}),/URL/);
 assert.equal(called,false);
});
test('cancelled HEAD calls release late responses without awaiting the network',async()=>{
 const {resolveUrlAttachment}=await import('./url-attachment.js');
 const controller=new AbortController();let cancelled=0;
 let resolveResponse!:(response:Response)=>void;
 const pending=resolveUrlAttachment({signal:controller.signal,capabilities:{fetch:async()=>new Promise<Response>(resolve=>{resolveResponse=resolve;})}},'https://example.test/image');
 await Promise.resolve();controller.abort(new Error('stop HEAD'));
 await assert.rejects(pending,/stop HEAD/);
 resolveResponse(new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-type':'image/png'}}));
 await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(cancelled,1);
});
test('source URL rejection still disposes caller prompt leases',async()=>{
 let disposed=0;
 const service=createLlmService({providers:[{name:'local',models:[{id:'local',attachmentTypes:['image/png']}],async *complete(){yield '';},completeSources(){throw Error('must not call');}}]});
 await assert.rejects(async()=>{for await(const event of service.streamSources!({model:'local',prompt:{bytes:{async *[Symbol.asyncIterator](){}},async dispose(){disposed++;}},attachments:[{mimeType:'image/png',url:'https://example.test/image'}],options:{},signal:new AbortController().signal}))void event;},/does not support URL/);
 assert.equal(disposed,1);
});

test('OpenAI URL image parts match the pinned provider including original URL spelling',async()=>{
 const {readFileSync}=await import('node:fs');
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/url-attachments-0.27.1.json',import.meta.url),'utf8')) as {cases:{url:string;mimeType:string;part:unknown}[]};
 for(const row of fixture.cases){
  const result=await invoke(['describe','--at',row.url,row.mimeType]);
  assert.equal(result.code,0,result.stderr);
  assert.deepEqual((result.bodies[0] as {messages:{content:unknown[]}[]}).messages[0]!.content[1],row.part);
 }
});

test('source messages preserve mixed local and URL attachment ordering and dispose only sources',async()=>{
 let body='',disposed=0;
 const source=(text:string)=>({bytes:{async *[Symbol.asyncIterator](){yield new TextEncoder().encode(text);}},async dispose(){disposed++;}});
 const service=createLlmService({providers:[createOpenAiProvider({apiKey:'fixture',models:[{id:'vision',endpoint:'chat',attachmentTypes:['image/*']}],transport:async request=>{for await(const bytes of request.body!)body+=new TextDecoder().decode(bytes);return {status:200,statusText:'OK',headers:[],body:{async *[Symbol.asyncIterator](){yield new TextEncoder().encode('{"choices":[{"message":{"content":"ok"}}]}');}},async dispose(){}};}})]});
 for await(const event of service.streamSources!({model:'vision',prompt:source('now'),messages:[{role:'user',content:source('before'),attachments:[{mimeType:'image/png',url:'https://example.test/old'}]}],attachments:[{mimeType:'image/png',source:source('bytes')},{mimeType:'image/png',url:'https://example.test/new'}],options:{},signal:new AbortController().signal,stream:false}))void event;
 const messages=JSON.parse(body).messages;
 assert.equal(messages[0].content[1].image_url.url,'https://example.test/old');
 assert.deepEqual(messages[1].content.slice(1).map((part:{image_url:{url:string}})=>part.image_url.url),['data:image/png;base64,Ynl0ZXM=','https://example.test/new']);
 assert.equal(disposed,3);
});

test('source attachment admission rejects a missing payload before provider invocation',async()=>{
 let called=false,disposed=0;
 const service=createLlmService({providers:[{name:'fixture',models:[{id:'fixture',attachmentTypes:['image/png']}],async *complete(){yield '';},async *completeSources(){called=true;yield 'wrong';}}]});
 await assert.rejects(async()=>{for await(const event of service.streamSources!({model:'fixture',prompt:{bytes:{async *[Symbol.asyncIterator](){}},async dispose(){disposed++;}},attachments:[{mimeType:'image/png'} as never],options:{},signal:new AbortController().signal}))void event;},/Invalid LLM attachment/);
 assert.equal(called,false);assert.equal(disposed,1);
});
