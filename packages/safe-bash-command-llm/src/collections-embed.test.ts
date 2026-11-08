import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {transactSqlite,withSqliteStatement} from 'safe-bash-sqlite-engine/storage';
import {withLlmCollections} from './collections.js';
import {createLlmService} from './service.js';

test('collection embeddings deduplicate before the provider and replace IDs with float32 stored content',async()=>{
 const fs=new MemoryFileSystem(),signal=new AbortController().signal;
 const options={fs,path:'/embeddings.db',signal,maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:8,now:()=>new Date('2026-10-02T00:00:00Z')};
 let calls=0,disposed=0;
 const service=createLlmService({providers:[{name:'test',models:[{id:'e',capabilities:['embed']}],async *complete(){},async embedSources(request){
  calls++;for await(const chunk of request.inputs[0]!.bytes)assert.ok(chunk.length<=16384);
  return {model:'e',vectors:[[1,0.5,-2]]};
 }}]});
 const input=(text:string)=>({bytes:{async *[Symbol.asyncIterator](){yield new TextEncoder().encode(text);}},async dispose(){disposed++;}});
 await withLlmCollections(options,async catalog=>{
  await catalog.collection('docs',{model:'e'});
  await catalog.embed('docs','one',{service,input:input('first'),directory:'/',maxInputBytes:100000,store:true});
  await catalog.embed('docs','duplicate',{service,input:input('first'),directory:'/',maxInputBytes:100000,store:true});
  await catalog.embed('docs','one',{service,input:input('second'),directory:'/',maxInputBytes:100000,store:true,metadata:{title:'second'}});
 });
 assert.equal(calls,2);assert.equal(disposed,3);
 await transactSqlite(options,async session=>withSqliteStatement(session.module,{...session,signal,sql:'SELECT id,hex(embedding),content,updated,metadata FROM embeddings'},async query=>{
  const rows=[];for await(const row of query.rows([],['text','text','text','integer','text']))rows.push(row);
  assert.deepEqual(rows,[['one','0000803F0000003F000000C0','second',1790899200n,'{"title":"second"}']]);
 }));
 assert.deepEqual((await fs.readdir('/')).map(row=>row.name),['embeddings.db']);
});

test('binary retained content exceeds scalar binding budget and dedup remains collection-local',async()=>{
 const fs=new MemoryFileSystem(),signal=new AbortController().signal;
 const options={fs,path:'/embeddings.db',signal,maxFileBytes:2097152,maxIndexBytes:1048576,maxOpenFiles:8,now:()=>new Date(0)};
 let calls=0;
 const service=createLlmService({providers:[{name:'test',models:[{id:'e',capabilities:['embed','embed-binary']}],async *complete(){},async embedSources(request){
  calls++;let size=0;for await(const chunk of request.inputs[0]!.bytes){assert.ok(chunk.length<=16384);size+=chunk.length;}assert.equal(size,131073);
  return {model:'e',vectors:[[1]]};
 }}]});
 const input=()=>({bytes:{async *[Symbol.asyncIterator](){yield new Uint8Array(131073).fill(255);}},async dispose(){}});
 await withLlmCollections(options,async catalog=>{
  for(const name of ['a','b']){
   await catalog.collection(name,{model:'e'});
   await catalog.embed(name,'one',{service,input:input(),directory:'/',maxInputBytes:200000,store:true,binary:true});
  }
 });
 assert.equal(calls,2);
 await transactSqlite(options,async session=>withSqliteStatement(session.module,{...session,signal,sql:'SELECT content,length(content_blob),hex(substr(content_blob,131073,1)) FROM embeddings ORDER BY collection_id'},async query=>{
  const rows=[];for await(const row of query.rows([],['null','integer','text']))rows.push(row);
  assert.deepEqual(rows,[[null,131073n,'FF'],[null,131073n,'FF']]);
 }));
 assert.deepEqual((await fs.readdir('/')).map(row=>row.name),['embeddings.db']);
});

test('embedding input failures and provider failures never publish and always dispose',async()=>{
 for(const failureKind of ['limit','utf8','provider','missing'] as const){
  const fs=new MemoryFileSystem(),signal=new AbortController().signal;
  const options={fs,path:'/embeddings.db',signal,maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:8,now:()=>new Date(0)};
  let disposed=0,calls=0;
  const service=createLlmService({providers:[{name:'test',models:[{id:'e',capabilities:['embed']}],async *complete(){},async embedSources(){calls++;throw new Error('provider failed');}}]});
  await assert.rejects(withLlmCollections(options,async catalog=>{
   await catalog.collection('a',{model:'e'});
   await catalog.embed(failureKind==='missing'?'absent':'a','one',{service,directory:'/',maxInputBytes:failureKind==='limit'?0:10,input:{bytes:{async *[Symbol.asyncIterator](){yield new Uint8Array([failureKind==='utf8'?255:97]);}},async dispose(){disposed++;}}});
  }));
  assert.equal(disposed,1);assert.equal(calls,failureKind==='provider'?1:0);
  assert.deepEqual(await fs.readdir('/'),[]);
 }
});

test('cancellation interrupts a stalled embedding source and preserves the reason',async()=>{
 const fs=new MemoryFileSystem(),controller=new AbortController(),signal=controller.signal;
 const reason=new Error('cancel input');let disposed=0;
 const service=createLlmService({providers:[]});
 await assert.rejects(withLlmCollections({fs,path:'/embeddings.db',signal,maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:8,now:()=>new Date(0)},async catalog=>{
  await catalog.collection('a',{model:'e'});
  await catalog.embed('a','one',{service,directory:'/',maxInputBytes:100,input:{bytes:{[Symbol.asyncIterator](){return {next(){controller.abort(reason);return new Promise(()=>{});}};}},async dispose(){disposed++;}}});
 }),error=>error===reason);
 assert.equal(disposed,1);assert.deepEqual(await fs.readdir('/'),[]);
});
