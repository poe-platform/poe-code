import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {transactSqlite} from './sqlite-transaction.js';
import {createLlmHistorySchema} from './history-schema.js';
import {withSqliteStatement} from './sqlite-statement.js';
import {prepareLlmSchemaRecord} from './history-schema-record.js';
import type {SqliteFinalizer} from './sqlite-finalization.js';
import fixtures from './fixtures/schema-identity-0.27.1.json' with {type:'json'};
const signal=new AbortController().signal;
test('stored schema IDs and native TEXT match genuine llm0.27.1 make_schema_id',async()=>{
 const fs=new MemoryFileSystem();const options={fs,path:'/logs.db',signal,maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:64};
 const finalizers:((editor:SqliteFinalizer)=>Promise<void>)[]=[];
 await transactSqlite({...options,finalize:async editor=>{for(const finalize of finalizers)await finalize(editor);}},async s=>{
  await createLlmHistorySchema(s,signal,'2026-10-02');
  for(const fixture of fixtures){const result=await prepareLlmSchemaRecord(s,fixture.input,signal);assert.equal(result.id,fixture.id);assert.ok(result.finalize);finalizers.push(result.finalize!);}
 });
 await transactSqlite(options,async s=>{
  await withSqliteStatement(s.module,{...s,signal,sql:'SELECT id,content FROM schemas ORDER BY rowid'},async q=>{const rows=[];for await(const row of q.rows([],['text','text']))rows.push(row);assert.deepEqual(rows,fixtures.map(f=>[f.id,f.content]));});
  for(const fixture of fixtures){const result=await prepareLlmSchemaRecord(s,fixture.input,signal);assert.equal(result.finalize,undefined);}
 });
});

test('expanded schema text exceeds scalar bindings with pinned hash and bounded native writes',async()=>{
 const fs=new MemoryFileSystem();const options={fs,path:'/logs.db',signal,maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:64};
 let finish!:(editor:SqliteFinalizer)=>Promise<void>;
 await transactSqlite({...options,finalize:editor=>finish(editor)},async s=>{
  await createLlmHistorySchema(s,signal,'2026-10-02');
  const heap=s.module.HEAPU8.length;
  const result=await prepareLlmSchemaRecord(s,JSON.stringify({x:'é'.repeat(20000)}),signal);
  assert.equal(result.id,'4c6f10b401febdc3058862abb2c77ffb');finish=result.finalize!;
  assert.equal(s.module.HEAPU8.length,heap);
 });
 await transactSqlite(options,async s=>{
  await withSqliteStatement(s.module,{...s,signal,sql:'SELECT typeof(content),length(content) FROM schemas'},async q=>{for await(const row of q.rows([],['text','integer']))assert.deepEqual(row,['text',120008n]);});
  await s.execute("UPDATE schemas SET content='original' WHERE id='4c6f10b401febdc3058862abb2c77ffb'");
  const duplicate=await prepareLlmSchemaRecord(s,JSON.stringify({x:'é'.repeat(20000)}),signal);assert.equal(duplicate.finalize,undefined);
  await withSqliteStatement(s.module,{...s,signal,sql:'SELECT content FROM schemas'},async q=>{for await(const row of q.rows([],['text']))assert.deepEqual(row,['original']);});
 });
});

test('cancelled schema finalization preserves canonical database and scratch cleanup',async()=>{
 const fs=new MemoryFileSystem();const options={fs,path:'/logs.db',signal,maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:64};
 await transactSqlite(options,s=>createLlmHistorySchema(s,signal,'2026-10-02'));const before=await fs.readFile('/logs.db');
 const controller=new AbortController();let finish!:(editor:SqliteFinalizer)=>Promise<void>;
 await assert.rejects(transactSqlite({...options,signal:controller.signal,finalize:async editor=>{controller.abort(new Error('cancel schema'));await finish(editor);}},async s=>{
  const result=await prepareLlmSchemaRecord(s,'{"x":1}',controller.signal);finish=result.finalize!;
 }));
 assert.deepEqual(await fs.readFile('/logs.db'),before);assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['logs.db']);
});
