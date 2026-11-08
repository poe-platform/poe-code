import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createLlmCommand } from './command.js';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/embed-0.27.1.json', import.meta.url),'utf8')) as {vectors:number[];cases:{args:string[];stdin:string;code:number;stdoutHex:string;stderr:string}[]};
test('stateless embed output bytes, diagnostics and flags match llm 0.27.1', async () => {
 const command=createLlmCommand({providers:[{name:'fixture',models:[{id:'fixture',capabilities:['embed']}],complete(){throw Error('must not complete');},async embed(request){return {model:request.model,vectors:[fixture.vectors]};},async embedSources(request){for(const input of request.inputs)for await(const chunk of input.bytes)void chunk;return {model:request.model,vectors:[fixture.vectors]};}}]});
 for(const row of fixture.cases){
  const stdout:Uint8Array[]=[],stderr:Uint8Array[]=[];
  const result=await command.execute({command:'llm',args:['embed',...row.args],fs:new MemoryFileSystem(),cwd:'/',env:{LLM_USER_PATH:'/config'},signal:new AbortController().signal,stdin:{async *[Symbol.asyncIterator](){yield new TextEncoder().encode(row.stdin);}},stdout:{async write(bytes){stdout.push(bytes.slice());}},stderr:{async write(bytes){stderr.push(bytes.slice());}}});
  assert.deepEqual({code:result.exitCode,stdoutHex:Buffer.concat(stdout).toString('hex'),stderr:Buffer.concat(stderr).toString()}, {code:row.code,stdoutHex:row.stdoutHex,stderr:row.stderr},JSON.stringify(row.args));
 }
});

import type { CommandContext, FileReadHandle } from 'safe-bash-contracts';
import type { LlmEmbeddingSourceRequest } from './types.js';
import { createLlmConfiguration } from './configuration.js';
async function execute(args:string[],fs:MemoryFileSystem,hook:(request:LlmEmbeddingSourceRequest)=>Promise<void>,extra:Partial<CommandContext>={},limits?:{maxInputBytes?:number;maxBufferedInputBytes?:number;maxOutputBytes?:number}){
 const stdout:Uint8Array[]=[],stderr:Uint8Array[]=[];
 const command=createLlmCommand({...(limits?{limits}:{}),providers:[{name:'fixture',models:[{id:'fixture',aliases:['vectors'],capabilities:['embed','embed-binary']}],complete(){throw Error('unexpected completion');},async embedSources(request){await hook(request);return {model:request.model,vectors:[[1,0.25]]};}}]});
 const result=await command.execute({command:'llm',args:['embed',...args],fs,cwd:'/',env:{LLM_USER_PATH:'/config'},signal:new AbortController().signal,stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(bytes){stdout.push(bytes.slice());}},stderr:{async write(bytes){stderr.push(bytes.slice());}},...extra});
 return {code:result.exitCode,stdout:Buffer.concat(stdout).toString(),stderr:Buffer.concat(stderr).toString()};
}
test('embedding files use retained reads bounded to 16 KiB and close on success/failure',async()=>{
 const backing=new MemoryFileSystem();await backing.writeFile('/input',new Uint8Array(100_000).fill(120));
 let closed=0,read=0;
 const fs=new Proxy(backing,{get(target,key){
  if(key==='openReadFile')return async(...args:Parameters<typeof backing.openReadFile>)=>{const reader=await target.openReadFile(...args);return {...reader,read:async(position:number,length:number,options:Parameters<FileReadHandle['read']>[2])=>{assert.ok(length<=16384);read++;return reader.read(position,length,options);},close:async()=>{closed++;await reader.close();}};};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const result=await execute(['-m','fixture','-i','/input'],fs,async request=>{let length=0;for await(const chunk of request.inputs[0]!.bytes)length+=chunk.length;assert.equal(length,100_000);},{},{maxBufferedInputBytes:100});
 assert.deepEqual(result,{code:0,stdout:'[1.0, 0.25]\n',stderr:''});assert.ok(read>1);assert.equal(closed,1);
 const failed=await execute(['-m','fixture','-i','/input'],fs,async()=>{throw Error('provider rejected');});
 assert.equal(failed.code,1);assert.equal(closed,2);
});
test('bounded stdin stages on caller storage, validates text and cleans up',async()=>{
 const fs=new MemoryFileSystem();let remaining=90_000,read=0;
 const result=await execute(['-m','fixture'],fs,async request=>{let total=0;for await(const chunk of request.inputs[0]!.bytes){assert.ok(chunk.length<=16384);total+=chunk.length;}assert.equal(total,90_000);},{stdinInput:{position:0,async read(max){assert.ok(max<=16384);read++;if(!remaining)return {done:true,value:undefined};const length=Math.min(max,remaining);remaining-=length;return {done:false,value:new Uint8Array(length).fill(97)};}}},{maxBufferedInputBytes:100});
 assert.equal(result.code,0);assert.ok(read>1);assert.deepEqual(await fs.readdir('/'),[]);
 let called=false;
 const invalid=await execute(['-m','fixture'],fs,async()=>{called=true;},{stdin:{async *[Symbol.asyncIterator](){yield Uint8Array.of(255);}}});
 assert.equal(invalid.code,1);assert.equal(called,false);assert.deepEqual(await fs.readdir('/'),[]);
 const limited=await execute(['-m','fixture'],fs,async()=>{called=true;},{stdin:{async *[Symbol.asyncIterator](){yield new Uint8Array(1000);}}},{maxInputBytes:100});
 assert.equal(limited.code,1);assert.equal(called,false);assert.deepEqual(await fs.readdir('/'),[]);
});
test('embedding model flag overrides environment then separate default and resolves aliases',async()=>{
 const fs=new MemoryFileSystem(),signal=new AbortController().signal;
 const config=createLlmConfiguration({fs,cwd:'/',env:{LLM_USER_PATH:'/config'},signal});
 await config.setDefaultModel('fixture','default_embedding_model.txt');await config.setAlias('mine','fixture');
 for(const [args,env]of [[['-c','hello'],{}],[['-c','hello'],{LLM_EMBEDDING_MODEL:'mine'}],[['-m','mine','-c','hello'],{LLM_EMBEDDING_MODEL:'missing'}]] as const){
  const result=await execute([...args],fs,async request=>{assert.equal(request.model,'fixture');let text='';for await(const bytes of request.inputs[0]!.bytes)text+=new TextDecoder().decode(bytes);assert.equal(text,'hello');},{env:{LLM_USER_PATH:'/config',...env}});
  assert.equal(result.code,0);
 }
});
test('binary embedding stdin preserves invalid UTF8 while --content remains text',async()=>{
 const fs=new MemoryFileSystem();
 const result=await execute(['-m','fixture','--binary'],fs,async request=>{assert.equal(request.binary,true);for await(const bytes of request.inputs[0]!.bytes)assert.deepEqual(bytes,Uint8Array.of(0,255));},{stdin:{async *[Symbol.asyncIterator](){yield Uint8Array.of(0,255);}}});
 assert.equal(result.code,0);assert.deepEqual(await fs.readdir('/'),[]);
 assert.equal((await execute(['-m','fixture','--binary','-c','hello'],fs,async request=>{assert.equal(request.binary,undefined);})).code,0);
});
test('file and stdin values match pinned text newline and binary semantics',async()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/embed-inputs-0.27.1.json',import.meta.url),'utf8')) as {files:Record<string,string>;cases:{args:string[];stdin:string;code:number;stdout:string;stderr:string;inputs:{binary:boolean;value:string}[]}[]};
 for(const row of fixture.cases){
  const fs=new MemoryFileSystem();for(const [path,hex]of Object.entries(fixture.files))await fs.writeFile('/'+path,Buffer.from(hex,'hex'));
  const inputs:{binary:boolean;value:string}[]=[];
  const result=await execute(row.args,fs,async request=>{const chunks:Uint8Array[]=[];for await(const bytes of request.inputs[0]!.bytes)chunks.push(bytes.slice());const value=Buffer.concat(chunks);inputs.push({binary:request.binary===true,value:value.toString(request.binary?'hex':'utf8')});},{stdin:{async *[Symbol.asyncIterator](){for(const byte of new TextEncoder().encode(row.stdin))yield Uint8Array.of(byte);}}});
  assert.deepEqual({...result,inputs},{code:row.code,stdout:row.stdout,stderr:row.stderr,inputs:row.inputs},JSON.stringify(row.args));
 }
});
test('embedding cancellation retires staged input and pending provider without output',async()=>{
 const fs=new MemoryFileSystem(),controller=new AbortController();
 await assert.rejects(execute(['-m','fixture'],fs,async()=>{controller.abort(new Error('stop embedding'));return new Promise(()=>{});},{signal:controller.signal,stdin:{async *[Symbol.asyncIterator](){yield new TextEncoder().encode('hello');}}}),/stop embedding/);
 assert.deepEqual(await fs.readdir('/'),[]);
});
test('embedding output limits stop writes and provider failures clean staged input',async()=>{
 const fs=new MemoryFileSystem();
 const stdin={async *[Symbol.asyncIterator](){yield new TextEncoder().encode('hello');}};
 const failed=await execute(['-m','fixture'],fs,async()=>{throw Error('embedding failed');},{stdin});
 assert.equal(failed.code,1);assert.equal(failed.stdout,'');assert.deepEqual(await fs.readdir('/'),[]);
 const limited=await execute(['-m','fixture'],fs,async()=>{},{stdin},{maxOutputBytes:1});
 assert.equal(limited.code,1);assert.equal(limited.stdout,'[');assert.match(limited.stderr,/output byte limit/);assert.deepEqual(await fs.readdir('/'),[]);
});
