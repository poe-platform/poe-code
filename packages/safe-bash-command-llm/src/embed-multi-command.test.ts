import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createLlmCommand} from './command.js';
import {createLlmCollectionCommands,withLlmCollections} from './collections.js';

test('delimited and JSON command calls, output and stored rows match genuine Python fixtures',async()=>{
 const cases=['embed-multi-csv-0.27.1.json','embed-multi-json-0.27.1.json'].flatMap(name=>JSON.parse(readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8'))) as {args:string[];input?:string;inputBase64?:string;code:number;out:string;err:string;calls:string[][];rows:{id:string;content:string}[]}[];
 for(const fixture of cases){
  const fs=new MemoryFileSystem(),signal=new AbortController().signal,calls:string[][]=[];
  const limits={maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:8};
  const command=createLlmCommand({collections:createLlmCollectionCommands(limits),providers:[{name:'test',models:[{id:'e',capabilities:['embed'],embeddingBatchSize:2}],async *complete(){},async embedSources(request){
   const texts=[];for(const input of request.inputs){let text='';for await(const bytes of input.bytes)text+=new TextDecoder().decode(bytes);texts.push(text);}calls.push(texts);return {model:'e',vectors:texts.map(text=>[text.length,1])};
  }}]});
  const out:Uint8Array[]=[],err:Uint8Array[]=[];
  const result=await command.execute({command:'llm',args:['embed-multi',...fixture.args],fs,cwd:'/',env:{},signal,stdin:{async *[Symbol.asyncIterator](){yield fixture.inputBase64?Uint8Array.from(atob(fixture.inputBase64),c=>c.charCodeAt(0)):new TextEncoder().encode(fixture.input);}},stdout:{async write(bytes){out.push(bytes.slice());}},stderr:{async write(bytes){err.push(bytes.slice());}}});
  assert.equal(result.exitCode,fixture.code,JSON.stringify(fixture.args)+' '+Buffer.concat(err).toString());
  const rows:{id:string;content:string}[]=[];
  await withLlmCollections({fs,path:'/db',signal,...limits,now:()=>new Date(0)},async catalog=>{await catalog.similarByVector('docs',[1,1],{},async row=>{let content='';for await(const bytes of row.content!.bytes)content+=new TextDecoder().decode(bytes);rows.push({id:row.id,content});});});
  rows.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  assert.deepEqual({code:result.exitCode,out:Buffer.concat(out).toString(),err:Buffer.concat(err).toString(),calls,rows},{code:fixture.code,out:fixture.out,err:fixture.err,calls:fixture.calls,rows:fixture.rows});
  assert.deepEqual((await fs.readdir('/')).map(row=>row.name),['db']);
 }
});

test('embed-multi imports CSV in provider-sized committed batches',async()=>{
 const fs=new MemoryFileSystem(),signal=new AbortController().signal,calls:string[][]=[];
 const limits={maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:8};
 const command=createLlmCommand({collections:createLlmCollectionCommands(limits),providers:[{name:'test',models:[{id:'e',capabilities:['embed'],embeddingBatchSize:2}],async *complete(){},async embedSources(request){
  const texts=[];for(const input of request.inputs){let text='';for await(const bytes of input.bytes)text+=new TextDecoder().decode(bytes);texts.push(text);}calls.push(texts);if(calls.length===2)throw new Error('provider unavailable');return {model:'e',vectors:texts.map(()=>[1])};
 }}]});
 const out:Uint8Array[]=[],err:Uint8Array[]=[];
 const result=await command.execute({command:'llm',args:['embed-multi','docs','-','--format','csv','-m','e','--store','--prefix','p:','--prepend','T:','--batch-size','3','-d','/db'],fs,cwd:'/',env:{},signal,stdin:{async *[Symbol.asyncIterator](){yield new TextEncoder().encode('id,title,body\n1,one,first\n2,two,second\n3,three,third\n');}},stdout:{async write(bytes){out.push(bytes.slice());}},stderr:{async write(bytes){err.push(bytes.slice());}}});
 assert.equal(result.exitCode,1);assert.match(Buffer.concat(err).toString(),/provider unavailable/);
 assert.deepEqual(calls,[['T:one first','T:two second'],['T:three third']]);
 const rows:string[]=[];
 await withLlmCollections({fs,path:'/db',signal,...limits,now:()=>new Date(0)},async catalog=>{await catalog.similarByVector('docs',[1],{},async row=>{rows.push(row.id);});});
 assert.deepEqual(rows.sort(),['p:1','p:2']);
 assert.deepEqual((await fs.readdir('/')).map(row=>row.name),['db']);
});

test('CSV command charges raw header bytes to the invocation input budget before transport',async()=>{
 const fs=new MemoryFileSystem(),signal=new AbortController().signal;let calls=0;
 const command=createLlmCommand({limits:{maxInputBytes:256},collections:createLlmCollectionCommands({maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:8}),providers:[{name:'test',models:[{id:'e',capabilities:['embed']}],async *complete(){},async embedSources(){calls++;return {model:'e',vectors:[[1]]};}}]});
 const err:Uint8Array[]=[];
 const result=await command.execute({command:'llm',args:['embed-multi','docs','-','--format','csv','-m','e','-d','/db'],fs,cwd:'/',env:{},signal,stdin:{async *[Symbol.asyncIterator](){yield new TextEncoder().encode('id,'+'header'.repeat(100)+'\n1,x\n');}},stdout:{async write(){}},stderr:{async write(bytes){err.push(bytes.slice());}}});
 assert.equal(result.exitCode,1);assert.equal(calls,0);assert.match(Buffer.concat(err).toString(),/llm input byte limit exceeded/);
 assert.deepEqual((await fs.readdir('/')).map(row=>row.name),['db']);
});
for(const [format,input,expectedCalls,expectedIds,expectedOut]of [
 ['json','[{"id":1,"body":"a"},{"id":2,"body":"b"},',[],[],''],
 ['nl','{"id":1,"body":"a"}\n{"id":2,"body":"b"}\n{bad}\n',[['a','b']],['1','2'],'Embedding\n']
] as const)test(format+' parsing failures preserve reference validation and batch commit boundaries',async()=>{
 const fs=new MemoryFileSystem(),signal=new AbortController().signal,calls:string[][]=[];
 const limits={maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:8};
 const command=createLlmCommand({collections:createLlmCollectionCommands(limits),providers:[{name:'test',models:[{id:'e',capabilities:['embed'],embeddingBatchSize:2}],async *complete(){},async embedSources(request){
  const texts=[];for(const input of request.inputs){let text='';for await(const bytes of input.bytes)text+=new TextDecoder().decode(bytes);texts.push(text);}calls.push(texts);return {model:'e',vectors:texts.map(()=>[1])};
 }}]});
 const out:Uint8Array[]=[],err:Uint8Array[]=[];
 const result=await command.execute({command:'llm',args:['embed-multi','docs','-','--format',format,'-m','e','--store','-d','/db'],fs,cwd:'/',env:{},signal,stdin:{async *[Symbol.asyncIterator](){yield new TextEncoder().encode(input);}},stdout:{async write(bytes){out.push(bytes.slice());}},stderr:{async write(bytes){err.push(bytes.slice());}}});
 assert.equal(result.exitCode,1);assert.ok(Buffer.concat(err).length);assert.equal(Buffer.concat(out).toString(),expectedOut);assert.deepEqual(calls,expectedCalls);
 const ids:string[]=[];await withLlmCollections({fs,path:'/db',signal,...limits,now:()=>new Date(0)},catalog=>catalog.similarByVector('docs',[1],{},async row=>{ids.push(row.id);}));
 assert.deepEqual(ids.sort(),expectedIds);assert.deepEqual((await fs.readdir('/')).map(row=>row.name),['db']);
});


test('JSON lone surrogate IDs fail after embedding while lone surrogate content fails before it',async()=>{
 // Captured from llm0.27.1 CliRunner: both errors follow Embedding, but only
 // the invalid ID reaches the provider before Python's SQLite encoder fails.
 for(const mode of ['stdin','file'])for(const raw of [false,true])for(const [input,expectedCalls]of [['[{"id":"\\ud800","body":"hello"}]',[['hello']]],['[{"id":"one","body":"\\ud800"}]',[]]] as const){
  const fs=new MemoryFileSystem(),signal=new AbortController().signal,calls:string[][]=[],out:Uint8Array[]=[];
  const limits={maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:8,now:()=>new Date(0)};
  const command=createLlmCommand({collections:createLlmCollectionCommands(limits),providers:[{name:'test',models:[{id:'e',capabilities:['embed']}],async *complete(){},async embedSources(request){
   const values:string[]=[];for(const source of request.inputs){let text='';for await(const bytes of source.bytes)text+=new TextDecoder().decode(bytes);values.push(text);}calls.push(values);return {model:'e',vectors:values.map(()=>[1])};
  }}]});
  const inputBytes=raw?Uint8Array.from(Array.from(input.replaceAll('\\ud800',String.fromCharCode(0xed,0xa0,0x80,0xed,0xb0,0x80)),char=>char.charCodeAt(0))):new TextEncoder().encode(input);
  if(mode==='file')await fs.writeFile('/input.json',inputBytes);
  const result=await command.execute({command:'llm',args:['embed-multi','docs',mode==='stdin'?'-':'/input.json','--format','json','-m','e','--store','-d','/db'],fs,cwd:'/',env:{},signal,stdin:{async *[Symbol.asyncIterator](){yield inputBytes;}},stdout:{async write(bytes){out.push(bytes.slice());}},stderr:{async write(){}}});assert.equal(result.exitCode,1);
  assert.deepEqual(calls,expectedCalls);assert.equal(Buffer.concat(out).toString(),'Embedding\n');
  const rows:unknown[]=[];await withLlmCollections({fs,path:'/db',signal,...limits},catalog=>catalog.list(row=>{rows.push(row.count);}));assert.deepEqual(rows,[0n]);
  assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name).sort(),mode==='stdin'?['db']:['db','input.json']);
 }
});

test('file prepass counts JSON and JSONL rows before embedding-shape validation',async()=>{
 for(const [format,input,code,progress]of [['json','[1]',1,true],['json','[{}]',1,true],['json','[]',0,true],['json','123',1,false],['nl','1\n',1,true],['nl','{}\n',1,true],['json','[1,',1,false],['nl','{"id":1,"body":"hello"}\ninvalid',1,false]] as const)for(const explicit of format==='json'&&(input.startsWith('[')||input.startsWith('{'))?[true,false]:[true]){
  const fs=new MemoryFileSystem(),signal=new AbortController().signal,out:Uint8Array[]=[];
  await fs.writeFile('/input',new TextEncoder().encode(input));
  const command=createLlmCommand({collections:createLlmCollectionCommands({maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:8}),providers:[{name:'test',models:[{id:'e',capabilities:['embed']}],async *complete(){},async embedSources(){assert.fail('reference never calls the provider');}}]});
  const result=await command.execute({command:'llm',args:['embed-multi','docs','/input',...(explicit?['--format',format]:[]),'-m','e','-d','/db'],fs,cwd:'/',env:{},signal,stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(bytes){out.push(bytes.slice());}},stderr:{async write(){}}});
  assert.equal(result.exitCode,code,input);assert.equal(Buffer.concat(out).toString(),progress?'Embedding\n':'',input);
  assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name).sort(),['db','input']);
 }
});
