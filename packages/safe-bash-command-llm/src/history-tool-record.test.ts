import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {transactSqlite} from './sqlite-transaction.js';
import {createLlmHistorySchema} from './history-schema.js';
import {prepareLlmToolRecord} from './history-tool-record.js';
import {withSqliteStatement} from './sqlite-statement.js';
import type {SqliteFinalizer} from './sqlite-finalization.js';
const signal=new AbortController().signal;
const options=(fs:MemoryFileSystem)=>({fs,path:'/logs.db',signal,maxFileBytes:2097152,maxIndexBytes:1048576,maxOpenFiles:64});
test('tool identity includes ordered Python JSON and optional nonempty plugin',async()=>{
 const fs=new MemoryFileSystem();
 const tools=[{name:'lookup',description:'café 😀',inputSchemaJson:'{"2":1.0,"1":2}'},{name:'lookup',description:'café 😀',inputSchemaJson:'{"2":1.0,"1":2}',plugin:''},{name:'lookup',description:'café 😀',inputSchemaJson:'{"2":1.0,"1":2}',plugin:'plugin'}];
 const finals:((editor:SqliteFinalizer)=>Promise<void>)[]=[];
 const result=await transactSqlite({...options(fs),finalize:async e=>{for(const final of finals)await final(e);}},async s=>{
  await createLlmHistorySchema(s,signal,'2026-10-02');const identities=[];
  for(const tool of tools){const record=await prepareLlmToolRecord(s,tool,signal);identities.push([record.id,record.hash]);if(record.finalize)finals.push(record.finalize);}
  return identities;
 });
 assert.equal(result.value[0]![0],1n);assert.equal(result.value[1]![0],1n);assert.equal(result.value[2]![0],2n);
 assert.equal(result.value[2]![1],'55b01451c61a676d35d559e9fe7fba445227b8cd0e37acc858d915a2ac387fb2');
 assert.equal(result.value[0]![1],'b58369088a63652254ad0b73be9868aa9cd5e3cd1afaa51aee9fadc045901bf3');
 await transactSqlite(options(fs),async s=>{
  await withSqliteStatement(s.module,{...s,signal,sql:"SELECT name,description,input_schema,COALESCE(plugin,'<NULL>') FROM tools ORDER BY id"},async q=>{
   const rows=[];for await(const row of q.rows([],['text','text','text','text']))rows.push(row);
   assert.deepEqual(rows,[['lookup','café 😀','{"2": 1.0, "1": 2}','<NULL>'],['lookup','café 😀','{"2": 1.0, "1": 2}','plugin']]);
  });
 });
});

test('large tool schema expansion and description remain native TEXT without scalar binds',async()=>{
 const fs=new MemoryFileSystem();let finish!:(e:SqliteFinalizer)=>Promise<void>;
 const schema='{"description":'+JSON.stringify('é'.repeat(20000))+'}';
 await transactSqlite({...options(fs),finalize:e=>finish(e)},async s=>{
  await createLlmHistorySchema(s,signal,'2026-10-02');const heap=s.module.HEAPU8.length;
  const result=await prepareLlmToolRecord(s,{name:'large',description:'x'.repeat(80000),inputSchemaJson:schema},signal);finish=result.finalize!;
  assert.equal(s.module.HEAPU8.length,heap);
 });
 await transactSqlite(options(fs),async s=>{
  await withSqliteStatement(s.module,{...s,signal,sql:'SELECT typeof(description),length(description),typeof(input_schema),length(input_schema) FROM tools'},async q=>{
   const rows=[];for await(const row of q.rows([],['text','integer','text','integer']))rows.push(row);
   assert.deepEqual(rows,[['text',80000n,'text',120019n]]);
  });
 });
});
test('tool records refuse custom triggers without changing canonical history',async()=>{
 const fs=new MemoryFileSystem();
 await transactSqlite(options(fs),async s=>{await createLlmHistorySchema(s,signal,'2026-10-02');await s.execute("CREATE TRIGGER custom_tool AFTER INSERT ON tools BEGIN SELECT 1; END");});
 const before=await fs.readFile('/logs.db');
 await assert.rejects(transactSqlite(options(fs),s=>prepareLlmToolRecord(s,{name:'lookup',inputSchemaJson:'{}'},signal)),/custom-schema/);
 assert.deepEqual(await fs.readFile('/logs.db'),before);
});

test('unpaired Unicode in native tool text fails without publishing a row',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite(options(fs),s=>createLlmHistorySchema(s,signal,'2026-10-02'));
 const before=await fs.readFile('/logs.db');
 await assert.rejects(transactSqlite(options(fs),s=>prepareLlmToolRecord(s,{name:'bad\ud800',inputSchemaJson:'{}'},signal)),/Unicode/);
 assert.deepEqual(await fs.readFile('/logs.db'),before);
});
