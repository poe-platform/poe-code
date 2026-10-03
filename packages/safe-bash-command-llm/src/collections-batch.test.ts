import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {withLlmCollections} from './collections.js';
import {createLlmService} from './service.js';
import type {LlmCollectionBatchEntry} from './collections-batch.js';

test('batch calls and stored rows match genuine LLM 0.27.1 fixtures',async()=>{
 const cases=JSON.parse(readFileSync(new URL('./fixtures/collections-batch-0.27.1.json',import.meta.url),'utf8')) as {entries:[string,string,null][];calls:string[][];rows:{id:string;content:string}[]}[];
 for(const expected of cases){
  const fs=new MemoryFileSystem(),signal=new AbortController().signal,calls:string[][]=[];
  const options={fs,path:'/db',signal,maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:8,now:()=>new Date(0)};
  const service=createLlmService({providers:[{name:'test',models:[{id:'e',capabilities:['embed'],embeddingBatchSize:2}],async *complete(){},async embedSources(request){
   const texts=[];for(const source of request.inputs){let text='';for await(const bytes of source.bytes)text+=new TextDecoder().decode(bytes);texts.push(text);}calls.push(texts);return {model:'e',vectors:texts.map(text=>[text.length,1])};
  }}]});
  const input=(text:string)=>({bytes:{async *[Symbol.asyncIterator](){yield new TextEncoder().encode(text);}},async dispose(){}});
  const rows:{id:string;content:string}[]=[];
  await withLlmCollections(options,async catalog=>{
   await catalog.collection('docs',{model:'e'});await catalog.embed('docs','old',{service,input:input('same'),directory:'/',maxInputBytes:10000,store:true});calls.length=0;
   await catalog.embedMany('docs',{service,entries:{async *[Symbol.asyncIterator](){for(const [id,text]of expected.entries)yield {id,input:input(text)};}},directory:'/',maxInputBytes:10000,batchSize:3,store:true});
   await catalog.similarByVector('docs',[1,1],{},async row=>{let content='';for await(const bytes of row.content!.bytes)content+=new TextDecoder().decode(bytes);rows.push({id:row.id,content});});
  });
  rows.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);assert.deepEqual({calls,rows},{calls:expected.calls,rows:expected.rows});
 }
});

test('batch dedup matches reference IDs selected by every hash in the batch',async()=>{
 const fs=new MemoryFileSystem(),signal=new AbortController().signal;
 const options={fs,path:'/db',signal,maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:8,now:()=>new Date(0)};
 const calls:string[][]=[];let disposed=0;
 const service=createLlmService({providers:[{name:'test',models:[{id:'e',capabilities:['embed']}],async *complete(){},async embedSources(request){
  const inputs=[];for(const input of request.inputs){let text='';for await(const bytes of input.bytes)text+=new TextDecoder().decode(bytes);inputs.push(text);}calls.push(inputs);
  return {model:'e',vectors:inputs.map(text=>[text.length,1])};
 }}]});
 const input=(text:string)=>({bytes:{async *[Symbol.asyncIterator](){yield new TextEncoder().encode(text);}},async dispose(){disposed++;}});
 await withLlmCollections(options,async catalog=>{
  await catalog.collection('docs',{model:'e'});
  await catalog.embed('docs','old',{service,input:input('same'),directory:'/',maxInputBytes:10000,store:true});calls.length=0;
  await catalog.embedMany('docs',{service,entries:{async *[Symbol.asyncIterator](){yield {id:'old',input:input('other')};yield {id:'new',input:input('same')};}},directory:'/',maxInputBytes:10000,batchSize:2,store:true});
  const rows:Record<string,string>={};
  await catalog.similarByVector('docs',[1,1],{},async row=>{let value='';for await(const bytes of row.content!.bytes)value+=new TextDecoder().decode(bytes);rows[row.id]=value;});
  assert.deepEqual(rows,{old:'same',new:'same'});
 });
 assert.deepEqual(calls,[['same']]);assert.equal(disposed,3);
 assert.deepEqual((await fs.readdir('/')).map(row=>row.name),['db']);
});
test('model batch size bounds calls and repeated IDs retain the final value',async()=>{
 const fs=new MemoryFileSystem(),signal=new AbortController().signal,calls:string[][]=[];
 const options={fs,path:'/db',signal,maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:8,now:()=>new Date(0)};
 const service=createLlmService({providers:[{name:'test',models:[{id:'e',capabilities:['embed'],embeddingBatchSize:2}],async *complete(){},async embedSources(request){
  const texts=[];for(const input of request.inputs){let text='';for await(const bytes of input.bytes)text+=new TextDecoder().decode(bytes);texts.push(text);}calls.push(texts);return {model:'e',vectors:texts.map(()=>[1])};
 }}]});
 const entries={async *[Symbol.asyncIterator](){for(const [id,text]of [['x','first'],['x','second'],['a','same'],['b','same']])yield {id:id!,input:{bytes:{async *[Symbol.asyncIterator](){yield new TextEncoder().encode(text);}},async dispose(){}}};}};
 await withLlmCollections(options,async catalog=>{
  await catalog.collection('docs',{model:'e'});
  await catalog.embedMany('docs',{service,entries,directory:'/',maxInputBytes:10000,batchSize:3,store:true});
  const found:Record<string,string>={};await catalog.similarByVector('docs',[1],{},async row=>{let text='';for await(const bytes of row.content!.bytes)text+=new TextDecoder().decode(bytes);found[row.id]=text;});
  assert.deepEqual(found,{a:'same',b:'same',x:'second'});
 });
 assert.deepEqual(calls,[['first','second'],['same','same']]);
});
test('batch byte budget rolls back and retires yielded inputs and the iterator',async()=>{
 const fs=new MemoryFileSystem(),signal=new AbortController().signal;let disposed=0,retired=false;
 const options={fs,path:'/db',signal,maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:8,now:()=>new Date(0)};
 const service=createLlmService({providers:[{name:'test',models:[{id:'e',capabilities:['embed']}],async *complete(){},async embedSources(){throw new Error('unexpected provider');}}]});
 const entries={async *[Symbol.asyncIterator](){
  try{for(let index=0;index<3;index++)yield {id:String(index),input:{bytes:{async *[Symbol.asyncIterator](){yield new Uint8Array(6);}},async dispose(){disposed++;}}};}
  finally{retired=true;}
 }};
 await assert.rejects(withLlmCollections(options,async catalog=>{await catalog.collection('docs',{model:'e'});await catalog.embedMany('docs',{service,entries,directory:'/',maxInputBytes:10});}),/input byte limit/);
 assert.equal(disposed,2);assert.equal(retired,true);assert.deepEqual(await fs.readdir('/'),[]);
});
test('cancelled batch does not wait for a stalled iterator and disposes a late lease',async()=>{
 const fs=new MemoryFileSystem(),controller=new AbortController();let resolve!:(entry:IteratorResult<LlmCollectionBatchEntry>)=>void,disposed=0;
 let entered!:()=>void;const ready=new Promise<void>(done=>{entered=done;});
 const options={fs,path:'/db',signal:controller.signal,maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:8,now:()=>new Date(0)};
 const service=createLlmService({providers:[{name:'test',models:[{id:'e',capabilities:['embed']}],async *complete(){},async embedSources(){throw new Error('unexpected provider');}}]});
 const entries:AsyncIterable<LlmCollectionBatchEntry>={[Symbol.asyncIterator](){return {next(){entered();return new Promise(done=>{resolve=done;});},return(){return new Promise(()=>{});}};}};
 const work=withLlmCollections(options,async catalog=>{await catalog.collection('docs',{model:'e'});await catalog.embedMany('docs',{service,entries,directory:'/',maxInputBytes:10});});
 await ready;const reason=new Error('cancelled batch');controller.abort(reason);await assert.rejects(work,error=>error===reason);
 resolve({done:false,value:{id:'late',input:{bytes:{async *[Symbol.asyncIterator](){}},async dispose(){disposed++;}}}});
 await new Promise<void>(done=>setImmediate(done));assert.equal(disposed,1);assert.deepEqual(await fs.readdir('/'),[]);
});
test('later provider failure rolls back earlier binary batches and disposes their leases',async()=>{
 const fs=new MemoryFileSystem(),signal=new AbortController().signal;let calls=0,disposed=0;
 const options={fs,path:'/db',signal,maxFileBytes:2097152,maxIndexBytes:1048576,maxOpenFiles:8,now:()=>new Date(0)};
 await withLlmCollections(options,catalog=>catalog.collection('docs',{model:'e'}));const before=await fs.readFile('/db');
 const service=createLlmService({providers:[{name:'test',models:[{id:'e',capabilities:['embed','embed-binary']}],async *complete(){},async embedSources(request){
  assert.equal(request.binary,true);let size=0;for(const input of request.inputs)for await(const chunk of input.bytes){assert.ok(chunk.length<=16384);size+=chunk.length;}
  assert.equal(size,131073);if(++calls===2)throw new Error('later provider failure');return {model:'e',vectors:[[1]]};
 }}]});
 const entries={async *[Symbol.asyncIterator](){for(let index=0;index<2;index++)yield {id:String(index),input:{bytes:{async *[Symbol.asyncIterator](){yield new Uint8Array(131073).fill(index);}},async dispose(){disposed++;}},metadata:{kind:'binary'}};}};
 await assert.rejects(withLlmCollections(options,catalog=>catalog.embedMany('docs',{service,entries,directory:'/',maxInputBytes:200000,batchSize:1,binary:true,store:true})),/later provider failure/);
 assert.equal(disposed,2);assert.equal(calls,2);assert.deepEqual(await fs.readFile('/db'),before);assert.deepEqual((await fs.readdir('/')).map(row=>row.name),['db']);
});
