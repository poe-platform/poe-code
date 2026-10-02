import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {toByteSource} from 'safe-bash-contracts';
import {transactSqlite} from './sqlite-transaction.js';
import {createLlmHistorySchema} from './history-schema.js';
import {withSqliteStatement} from './sqlite-statement.js';
import {createLlmSpool} from './retained-spool.js';
import {prepareLlmFragmentRecord} from './history-fragment-record.js';
import type {SqliteFinalizer} from './sqlite-finalization.js';
const signal=new AbortController().signal;
const options=(fs:MemoryFileSystem)=>({fs,path:'/logs.db',signal,maxFileBytes:2097152,maxIndexBytes:1048576,maxOpenFiles:64});
test('fragment identities, deduplication and source metadata match pinned ensure_fragment',async()=>{
 const fs=new MemoryFileSystem();const finals:((e:SqliteFinalizer)=>Promise<void>)[]=[];
 await transactSqlite({...options(fs),finalize:async e=>{for(const final of finals)await final(e);}},async s=>{
  await createLlmHistorySchema(s,signal,'2026-10-02');
  const ids=[];
  for(const [text,source]of [['alpha',null],['café 😀','file:source'],['alpha','later'],['','']] as const){
   const result=await prepareLlmFragmentRecord(s,{content:()=>toByteSource(text),source},signal);ids.push(result.id);if(result.finalize)finals.push(result.finalize);
  }
  assert.deepEqual(ids,[1n,2n,1n,3n]);assert.equal(finals.length,3);
 });
 await transactSqlite(options(fs),async s=>{
  await withSqliteStatement(s.module,{...s,signal,sql:"SELECT id,hash,content,COALESCE(source,'<NULL>') FROM fragments ORDER BY id"},async q=>{const rows=[];for await(const row of q.rows([],['integer','text','text','text']))rows.push(row);assert.deepEqual(rows,[[1n,'8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8','alpha','<NULL>'],[2n,'043764df773ac7ceea6175e1498893e6ee33e79885288417cc1d75cba6094827','café 😀','file:source'],[3n,'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855','','']]);});
 });
});
test('changed replay refuses publication even when the byte length is unchanged',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite(options(fs),s=>createLlmHistorySchema(s,signal,'2026-10-02'));const before=await fs.readFile('/logs.db');
 let pass=0,finish!:(e:SqliteFinalizer)=>Promise<void>;
 await assert.rejects(transactSqlite({...options(fs),finalize:e=>finish(e)},async s=>{
  const result=await prepareLlmFragmentRecord(s,{content:()=>toByteSource(++pass===1?'first':'other')},signal);finish=result.finalize!;
 }),/changed/);
 assert.deepEqual(await fs.readFile('/logs.db'),before);assert.deepEqual((await fs.readdir('/')).map(x=>x.name),['logs.db']);
});

test('large split UTF-8 fragments stay native TEXT beyond scalar binding limits',async()=>{
 const fs=new MemoryFileSystem();let finish!:(e:SqliteFinalizer)=>Promise<void>;
 const bytes=new TextEncoder().encode('é'.repeat(40000));
 await transactSqlite({...options(fs),finalize:e=>finish(e)},async s=>{
  await createLlmHistorySchema(s,signal,'2026-10-02');const heap=s.module.HEAPU8.length;
  const result=await prepareLlmFragmentRecord(s,{content:()=>({async *[Symbol.asyncIterator](){for(let offset=0;offset<bytes.length;offset+=8191)yield bytes.subarray(offset,offset+8191);}})},signal);finish=result.finalize!;
  assert.equal(s.module.HEAPU8.length,heap);
 });
 await transactSqlite(options(fs),async s=>{
  await withSqliteStatement(s.module,{...s,signal,sql:'SELECT id,typeof(content),length(content),length(datetime_utc) FROM fragments'},async q=>{for await(const row of q.rows([],['integer','text','integer','integer']))assert.deepEqual(row,[1n,'text',40000n,19n]);});
  await s.execute('PRAGMA integrity_check');
 });
});

test('pending fragment cancellation closes the source before canonical publication',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite(options(fs),s=>createLlmHistorySchema(s,signal,'2026-10-02'));const before=await fs.readFile('/logs.db');
 const controller=new AbortController();let ready!:()=>void,closed=0;
 const started=new Promise<void>(resolve=>{ready=resolve;});
 const content=()=>({[Symbol.asyncIterator](){return {next(){ready();return new Promise<IteratorResult<Uint8Array>>(()=>{});},async return(){closed++;return {done:true as const,value:undefined};}};}});
 const pending=transactSqlite({...options(fs),signal:controller.signal},s=>prepareLlmFragmentRecord(s,{content},controller.signal));
 await started;controller.abort(new Error('cancel fragment'));await assert.rejects(pending);assert.equal(closed,1);assert.deepEqual(await fs.readFile('/logs.db'),before);
});

test('caller-retained fragments survive naming, hashing and native publication',async()=>{
 const fs=new MemoryFileSystem();
 const spool=await createLlmSpool(fs,'/',signal,'input');
 try{
  for(let i=0;i<5;i++)await spool.write(new TextEncoder().encode('é'.repeat(8000)));
  // Consumers may stop early before hashing and finalization replay the same bytes.
  for await(const chunk of spool.replay()){assert.equal(chunk.length,16384);break;}
  let finish!:(e:SqliteFinalizer)=>Promise<void>;
  await transactSqlite({...options(fs),finalize:e=>finish(e)},async s=>{
   await createLlmHistorySchema(s,signal,'2026-10-02');
   const result=await prepareLlmFragmentRecord(s,{content:()=>spool.replay()},signal);
   finish=result.finalize!;
  });
  await transactSqlite(options(fs),async s=>{
   await withSqliteStatement(s.module,{...s,signal,sql:'SELECT typeof(content),length(content) FROM fragments'},async q=>{
    const rows=[];for await(const row of q.rows([],['text','integer']))rows.push(row);
    assert.deepEqual(rows,[['text',40000n]]);
   });
  });
 }finally{await spool.close();}
 assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['logs.db']);
});
