import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {transactSqlite,withSqliteStatement} from 'safe-bash-sqlite-engine/storage';
import {withLlmCollections} from './collections.js';
import {createLlmService} from './service.js';

const signal=new AbortController().signal;
const options=(fs:MemoryFileSystem)=>({fs,path:'/embeddings.db',signal,maxFileBytes:2097152,maxIndexBytes:1048576,maxOpenFiles:8,now:()=>new Date(0)});
async function fixture(){
 const fs=new MemoryFileSystem();
 await withLlmCollections(options(fs),async catalog=>{await catalog.collection('docs',{model:'e'});await catalog.collection('other',{model:'e'});});
 await transactSqlite(options(fs),async session=>{
  await session.execute("INSERT INTO embeddings(collection_id,id,embedding,content,metadata) VALUES (1,'z',X'0000803F00000000','last','{}'),(1,'a',X'0000803F00000000','first','{\"n\":1}'),(1,'ab',X'000000000000803F',NULL,NULL),(1,'a_',X'000080BF00000000',NULL,NULL),(2,'hidden',X'0000803F00000000',NULL,NULL)");
 });return fs;
}
async function text(field:{bytes:AsyncIterable<Uint8Array>}|null){if(!field)return null;let result='';const decoder=new TextDecoder();for await(const bytes of field.bytes)result+=decoder.decode(bytes,{stream:true});return result+decoder.decode();}

test('similarity scores, ties, stored fields and SQL LIKE prefix match the reference',async()=>{
 const fs=await fixture(),before=await fs.readFile('/embeddings.db');
 await withLlmCollections(options(fs),async catalog=>{
  const rows:unknown[]=[];
  await catalog.similarByVector('docs',[1,0],{number:-1},async row=>{rows.push([row.id,row.score,await text(row.content),await text(row.metadata)]);});
  assert.deepEqual(rows,[['a',1,'first','{"n":1}'],['z',1,'last','{}'],['ab',0,null,null],['a_',-1,null,null]]);
  const filtered:unknown[]=[];
  await catalog.similarByVector('docs',[1,0],{prefix:'a_',number:10},row=>{filtered.push([row.id,row.score]);});
  assert.deepEqual(filtered,[['ab',0],['a_',-1]]);
 });
 assert.deepEqual((await fs.readdir('/')).map(row=>row.name),['embeddings.db']);
 assert.deepEqual(await fs.readFile('/embeddings.db'),before);
});

test('similarity query embeds through the shared service, transfers cleanup, and enforces input limits',async()=>{
 const fs=await fixture();let disposed=0,calls=0;
 const service=createLlmService({providers:[{name:'fixture',models:[{id:'e',capabilities:['embed']}],async *complete(){},async embedSources(request){
  calls++;let value='';for await(const bytes of request.inputs[0]!.bytes)value+=new TextDecoder().decode(bytes);assert.equal(value,'question');return {model:'e',vectors:[[1,0]]};
 }}]});
 const input=()=>({bytes:{async *[Symbol.asyncIterator](){yield new TextEncoder().encode('question');}},async dispose(){disposed++;}});
 await withLlmCollections(options(fs),async catalog=>{
  const ids:string[]=[];await catalog.similar('docs',{service,input:input(),maxInputBytes:100,number:2},row=>{ids.push(row.id);});assert.deepEqual(ids,['a','z']);
 });
 assert.equal(disposed,1);assert.equal(calls,1);
 await assert.rejects(withLlmCollections(options(fs),async catalog=>catalog.similar('docs',{service,input:input(),maxInputBytes:1},()=>{})),/byte limit/);
 assert.equal(disposed,2);
});

test('similarity fields expire with each callback and visitor failure rolls back earlier writes',async()=>{
 const fs=await fixture();let escaped:AsyncIterable<Uint8Array>|undefined;
 await withLlmCollections(options(fs),async catalog=>{
  await catalog.similarByVector('docs',[1,0],{number:1},row=>{escaped=row.content!.bytes;});
  await assert.rejects(async()=>{for await(const bytes of escaped!)void bytes;},{code:'EBADF'});
 });
 const failure=new Error('visitor failure');
 await assert.rejects(withLlmCollections(options(fs),async catalog=>{
  await catalog.collection('unpublished',{model:'e'});
  await catalog.similarById('docs','a',{},()=>{throw failure;});
 }),error=>error===failure);
 await withLlmCollections(options(fs),async catalog=>{const names:string[]=[];await catalog.list(row=>{names.push(row.name);});assert.deepEqual(names,['docs','other']);});
});

test('cancellation interrupts a pending result visitor without publishing or leaking scratch files',async()=>{
 const fs=await fixture(),controller=new AbortController(),failure=new Error('stop search');
 await assert.rejects(withLlmCollections({...options(fs),signal:controller.signal},async catalog=>{
  await catalog.similarByVector('docs',[1,0],{},()=>{controller.abort(failure);return new Promise(()=>{});});
 }),error=>error===failure);
 assert.deepEqual((await fs.readdir('/')).map(row=>row.name),['embeddings.db']);
});

test('similarity by ID excludes itself and missing IDs preserve reference failure',async()=>{
 const fs=await fixture();
 await withLlmCollections(options(fs),async catalog=>{
  const rows:string[]=[];await catalog.similarById('docs','a',{number:2},row=>{rows.push(row.id);});assert.deepEqual(rows,['z','ab']);
 });
 await assert.rejects(withLlmCollections(options(fs),async catalog=>catalog.similarById('docs','missing',{},()=>{})),/ID not found/);
});

test('zero limit skips scoring, unequal dimensions preserve reference cosine, and zero norms fail',async()=>{
 const fs=await fixture();
 await withLlmCollections(options(fs),async catalog=>{
  await catalog.similarByVector('docs',[0,0],{number:0},()=>{throw new Error('unexpected row');});
  const scores:number[]=[];await catalog.similarByVector('docs',[1,0,1],{number:1},row=>{scores.push(row.score!);});assert.equal(scores[0],1/Math.sqrt(2));
 });
 await assert.rejects(withLlmCollections(options(fs),async catalog=>catalog.similarByVector('docs',[0,0],{},()=>{})),/division by zero/);
 // Failed searches never damage the canonical database.
 await transactSqlite(options(fs),async session=>withSqliteStatement(session.module,{...session,signal,sql:'SELECT count(*) FROM embeddings'},async query=>{for await(const [count]of query.rows([],['integer']))assert.equal(count,5n);}));
});

test('unawaited admitted queries drain input cleanup before publishing',async()=>{
 const fs=await fixture(),failure=new Error('lease cleanup failed');
 const service={...createLlmService({providers:[]}),async embedSources(){return {model:'e',vectors:[[1,0]]};}};
 await assert.rejects(withLlmCollections(options(fs),async catalog=>{
  await catalog.collection('unpublished',{model:'e'});
  void catalog.similar('docs',{service,maxInputBytes:100,input:{bytes:{async *[Symbol.asyncIterator](){}},async dispose(){throw failure;}}},()=>{}).catch(()=>{});
 }),error=>error===failure);
 await withLlmCollections(options(fs),async catalog=>{const names:string[]=[];await catalog.list(row=>{names.push(row.name);});assert.deepEqual(names,['docs','other']);});
});

test('stored query vectors and result content stream beyond the native scalar budget',async()=>{
 const fs=new MemoryFileSystem();
 const vector=Array.from({length:32769},(_,index)=>index%2?0:1);
 const service=createLlmService({providers:[{name:'fixture',models:[{id:'e',capabilities:['embed']}],async *complete(){},async embedSources(){return {model:'e',vectors:[vector]};}}]});
 await withLlmCollections(options(fs),async catalog=>{
  await catalog.collection('docs',{model:'e'});
  for(const id of ['a','b'])await catalog.embed('docs',id,{service,directory:'/',maxInputBytes:200000,store:true,input:{bytes:{async *[Symbol.asyncIterator](){yield new Uint8Array(131073).fill(id.charCodeAt(0));}},async dispose(){}}});
  let count=0;
  await catalog.similarById('docs','a',{},async row=>{
   count++;assert.equal(row.id,'b');assert.ok(Math.abs(row.score!-1)<1e-15);
   let size=0;for await(const bytes of row.content!.bytes){assert.ok(bytes.length<=16384);size+=bytes.length;assert.ok(bytes.every(byte=>byte===98));}
   assert.equal(size,131073);
  });assert.equal(count,1);
 });
});

test('nonfinite similarity becomes SQL NULL and malformed vectors abort the operation',async()=>{
 const fs=await fixture();
 await withLlmCollections(options(fs),async catalog=>{
  const scores:unknown[]=[];await catalog.similarByVector('docs',[NaN,1],{},row=>{scores.push(row.score);});assert.deepEqual(scores,[null,null,null,null]);
 });
 await transactSqlite(options(fs),session=>session.execute("UPDATE embeddings SET embedding=X'00' WHERE id='a'"));
 await assert.rejects(withLlmCollections(options(fs),async catalog=>catalog.similarByVector('docs',[1],{},()=>{})),/Malformed embedding/);
});
