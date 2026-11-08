import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {transactSqlite,withSqliteStatement} from 'safe-bash-sqlite-engine/storage';
import {withLlmCollections} from './collections.js';

const signal=new AbortController().signal;
const limits={maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:8};
const options=(fs:MemoryFileSystem)=>({fs,path:'/embeddings.db',signal,...limits,now:()=>new Date('2026-10-02T00:00:00Z')});

test('creates model-bound collections, reopens them, and lists counts without collecting rows',async()=>{
 const fs=new MemoryFileSystem();
 await withLlmCollections(options(fs),async catalog=>{
  assert.deepEqual(await catalog.collection('documents',{model:'embed'}),{id:1n,name:'documents',model:'embed'});
  assert.deepEqual(await catalog.collection('documents',{model:'ignored'}),{id:1n,name:'documents',model:'embed'});
  await catalog.collection('notes',{model:'other'});
 });
 await transactSqlite(options(fs),async session=>session.execute("INSERT INTO embeddings(collection_id,id,embedding) VALUES(1,'one',X'0000803f')"));
 const result=await withLlmCollections(options(fs),async catalog=>{
  const rows: unknown[]=[];await catalog.list(row=>{rows.push(row);});return rows;
 });
 assert.deepEqual(result.value,[{id:1n,name:'documents',model:'embed',count:1n},{id:2n,name:'notes',model:'other',count:0n}]);
 assert.deepEqual((await fs.readdir('/')).map(row=>row.name),['embeddings.db']);
});

test('missing collections preserve reference errors and failed callbacks publish nothing',async()=>{
 const fs=new MemoryFileSystem();
 await assert.rejects(withLlmCollections(options(fs),async catalog=>catalog.collection('absent',{create:false})),/Collection 'absent' does not exist/);
 await assert.rejects(fs.stat('/embeddings.db'),{code:'ENOENT'});
 await assert.rejects(withLlmCollections(options(fs),async catalog=>catalog.collection('absent')),/Either model= or model_id= must be provided/);
});

test('deletion removes only the selected collection and its embeddings atomically',async()=>{
 const fs=new MemoryFileSystem();
 await withLlmCollections(options(fs),async catalog=>{await catalog.collection('one',{model:'e'});await catalog.collection('two',{model:'e'});});
 await transactSqlite(options(fs),async session=>session.execute("INSERT INTO embeddings(collection_id,id) VALUES(1,'a'),(2,'b')"));
 await withLlmCollections(options(fs),async catalog=>catalog.delete('one'));
 await transactSqlite(options(fs),async session=>withSqliteStatement(session.module,{...session,signal,sql:'SELECT collection_id,id FROM embeddings'},async statement=>{
  const rows=[];for await(const row of statement.rows([],['integer','text']))rows.push(row);assert.deepEqual(rows,[[2n,'b']]);
 }));
});

test('collection operations reject escaped catalog access',async()=>{
 const fs=new MemoryFileSystem();
 const receipt=await withLlmCollections(options(fs),async catalog=>catalog);
 await assert.rejects(receipt.value.collection('late',{model:'e'}),{code:'EBADF'});
 await assert.rejects(receipt.value.list(()=>{}),{code:'EBADF'});
});

test('collection schema and migration records match the pinned Python reference',async()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/collections-schema-0.27.1.json',import.meta.url),'utf8')) as {tables:Record<string,{cid:number;name:string;type:string;notnull:number;dflt_value:null;pk:number}[]>;migrations:string[]};
 const fs=new MemoryFileSystem();
 await withLlmCollections(options(fs),async()=>{});
 await transactSqlite(options(fs),async session=>{
  for(const [table,expected]of Object.entries(fixture.tables))await withSqliteStatement(session.module,{...session,signal,sql:'SELECT cid,name,type,"notnull",dflt_value,pk FROM pragma_table_info(?)'},async query=>{
   const rows=[];for await(const [cid,name,type,notnull,dflt_value,pk]of query.rows([table],['integer','text','text','integer','null','integer']))rows.push({cid:Number(cid),name,type,notnull:Number(notnull),dflt_value,pk:Number(pk)});
   assert.deepEqual(rows,expected);
  });
  await withSqliteStatement(session.module,{...session,signal,sql:"SELECT name FROM _sqlite_migrations WHERE migration_set='llm.embeddings' ORDER BY name"},async query=>{
   const names=[];for await(const [name]of query.rows([],['text']))names.push(name);assert.deepEqual(names,fixture.migrations);
  });
 });
});

test('caught operation errors still prevent publishing partially changed collections',async()=>{
 const fs=new MemoryFileSystem();
 await assert.rejects(withLlmCollections(options(fs),async catalog=>{
  await catalog.collection('one',{model:'e'});
  try{await catalog.collection('missing',{create:false});}catch{/* Transaction must still fail. */}
 }),/does not exist/);
 await assert.rejects(fs.stat('/embeddings.db'),{code:'ENOENT'});
});

test('unawaited admitted work drains before commit and overlapping calls reject',async()=>{
 const fs=new MemoryFileSystem();
 await withLlmCollections(options(fs),async catalog=>{void catalog.collection('one',{model:'e'});});
 await assert.rejects(withLlmCollections(options(fs),async catalog=>{
  const first=catalog.collection('two',{model:'e'});
  await assert.rejects(catalog.collection('three',{model:'e'}),{code:'EBUSY'});
  await first;
 }),{code:'EBUSY'});
 await withLlmCollections(options(fs),async catalog=>{const names:string[]=[];await catalog.list(row=>{names.push(row.name);});assert.deepEqual(names,['one']);});
});

test('callback and pending-operation failures are both retained',async()=>{
 const fs=new MemoryFileSystem(),failure=new Error('caller failed');
 await assert.rejects(withLlmCollections(options(fs),async catalog=>{
  void catalog.collection('missing',{create:false});
  throw failure;
 }),error=>error instanceof AggregateError&&error.errors[0]===failure&&error.errors[1]?.message==="Collection 'missing' does not exist");
 await assert.rejects(fs.stat('/embeddings.db'),{code:'ENOENT'});
});
