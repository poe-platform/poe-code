import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {toByteSource} from 'safe-bash-contracts';
import {transactSqlite} from './sqlite-transaction.js';
import {createLlmHistorySchema} from './history-schema.js';
import {withSqliteStatement} from './sqlite-statement.js';
import {prepareLlmResponseRecord} from './history-response-record.js';
import type {SqliteFinalizer} from './sqlite-finalization.js';
const signal=new AbortController().signal;
test('bounded response record finalization publishes genuine TEXT and a searchable native history index',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/history');
 const options={fs,path:'/history/logs.db',signal,maxFileBytes:8*1048576,maxIndexBytes:1048576,maxOpenFiles:64};
 let finish!:(editor:SqliteFinalizer)=>Promise<void>;
 const prompt='x'.repeat(70000)+' alpha beta',response='y'.repeat(70000)+' gamma delta';
 await transactSqlite({...options,finalize:editor=>finish(editor)},async s=>{
  await createLlmHistorySchema(s,signal,'2026-10-02');
  finish=await prepareLlmResponseRecord(s,{id:'r1',model:'fixture',prompt:{size:prompt.length,bytes:toByteSource(prompt)},response:{size:response.length,bytes:toByteSource(response)},duration_ms:12n},signal);
 });
 await transactSqlite(options,async s=>{
  await s.execute("INSERT INTO responses_fts(responses_fts,rank) VALUES('integrity-check',1);");
  await withSqliteStatement(s.module,{...s,signal,sql:"SELECT id,typeof(prompt),length(prompt),typeof(response),length(response),duration_ms FROM responses"},async q=>{for await(const row of q.rows([],['text','text','integer','text','integer','integer']))assert.deepEqual(row,['r1','text',BigInt(prompt.length),'text',BigInt(response.length),12n]);});
  await withSqliteStatement(s.module,{...s,signal,sql:"SELECT responses.id FROM responses JOIN responses_fts ON responses.rowid=responses_fts.rowid WHERE responses_fts MATCH '"+'"alpha beta"'+"'"},async q=>{const rows=[];for await(const row of q.rows([],['text']))rows.push(row);assert.deepEqual(rows,[['r1']]);});
  await s.execute("UPDATE responses SET prompt='replacement' WHERE id='r1'; INSERT INTO responses_fts(responses_fts,rank) VALUES('integrity-check',1);");
 });
});

test('a short field source prevents canonical response or schema publication',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/history');
 const options={fs,path:'/history/logs.db',signal,maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:64};
 await transactSqlite(options,s=>createLlmHistorySchema(s,signal,'2026-10-02'));
 const before=await fs.readFile('/history/logs.db');let finish!:(editor:SqliteFinalizer)=>Promise<void>;
 await assert.rejects(transactSqlite({...options,finalize:editor=>finish(editor)},async s=>{
  finish=await prepareLlmResponseRecord(s,{id:'bad',model:'fixture',response:{size:10,bytes:toByteSource('short')}},signal);
 }));
 assert.deepEqual(await fs.readFile('/history/logs.db'),before);
 assert.deepEqual((await fs.readdir('/history')).map(x=>x.name),['logs.db']);
});

test('duplicate response failure restores the insert trigger even when the caller catches it',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/history');
 const options={fs,path:'/history/logs.db',signal,maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:64};
 await transactSqlite(options,async s=>{
  await createLlmHistorySchema(s,signal,'2026-10-02');
  await s.execute("INSERT INTO responses(id,model,prompt,response) VALUES('existing','fixture','old','text')");
  await assert.rejects(prepareLlmResponseRecord(s,{id:'existing',model:'fixture',prompt:'replacement'},signal));
  await s.execute("INSERT INTO responses(id,model,prompt,response) VALUES('next','fixture','new','answer'); INSERT INTO responses_fts(responses_fts,rank) VALUES('integrity-check',1);");
 });
});

test('NULL prompt and response publish a native empty document',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/history');
 const options={fs,path:'/history/logs.db',signal,maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:64};
 let finish!:(editor:SqliteFinalizer)=>Promise<void>;
 await transactSqlite({...options,finalize:editor=>finish(editor)},async s=>{
  await createLlmHistorySchema(s,signal,'2026-10-02');finish=await prepareLlmResponseRecord(s,{id:'empty',model:'fixture'},signal);
 });
 await transactSqlite(options,async s=>{
  await s.execute("INSERT INTO responses_fts(responses_fts,rank) VALUES('integrity-check',1)");
  await withSqliteStatement(s.module,{...s,signal,sql:'SELECT prompt,response FROM responses'},async q=>{for await(const row of q.rows([],['null','null']))assert.deepEqual(row,[null,null]);});
 });
});

test('custom response indexes are rejected before any placeholder or trigger mutation',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/history');
 const options={fs,path:'/history/logs.db',signal,maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:64};
 await transactSqlite(options,async s=>{
  await createLlmHistorySchema(s,signal,'2026-10-02');await s.execute('CREATE INDEX custom_response ON responses(response)');
  await assert.rejects(prepareLlmResponseRecord(s,{id:'r',model:'fixture',response:{size:3,bytes:toByteSource('abc')}},signal),/index-aware/);
  await s.execute("INSERT INTO responses(id,model,prompt,response) VALUES('native','fixture','prompt','answer'); INSERT INTO responses_fts(responses_fts,rank) VALUES('integrity-check',1);");
 });
});

test('response writer accepts every pinned migrated historical database',async()=>{
 const {inflateSync}=await import('node:zlib');
 const {default:reference}=await import('./fixtures/history-migrations-0.27.1.json',{with:{type:'json'}});
 const {migrateLlmHistorySchema}=await import('./history-migrations.js');
 for(const fixture of reference.cases){
  const fs=new MemoryFileSystem();await fs.writeFile('/logs.db',inflateSync(Buffer.from(fixture.databaseZlib,'base64')));
  const options={fs,path:'/logs.db',signal,maxFileBytes:2097152,maxIndexBytes:2097152,maxOpenFiles:64};let finish!:(editor:SqliteFinalizer)=>Promise<void>;
  await transactSqlite({...options,finalize:editor=>finish(editor)},async s=>{
   await migrateLlmHistorySchema(s,signal,'2026-10-02');
   finish=await prepareLlmResponseRecord(s,{id:'new-response',model:'fixture',prompt:'new prompt',response:'new response'},signal);
  });
  await transactSqlite(options,s=>s.execute("INSERT INTO responses_fts(responses_fts,rank) VALUES('integrity-check',1)"));
 }
});

test('non-default tokenizers are rejected before shadow data can be corrupted',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/history');
 const options={fs,path:'/history/logs.db',signal,maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:64};
 await transactSqlite(options,async s=>{
  await createLlmHistorySchema(s,signal,'2026-10-02');
  await s.execute("DROP TABLE responses_fts; CREATE VIRTUAL TABLE responses_fts USING fts5(prompt,response,content='responses',tokenize='porter');");
  await assert.rejects(prepareLlmResponseRecord(s,{id:'r',model:'fixture',response:'stemming'},signal),/FTS definition/);
  await s.execute("INSERT INTO responses(id,model,prompt,response) VALUES('native','fixture','prompt','stemming'); INSERT INTO responses_fts(responses_fts,rank) VALUES('integrity-check',1);");
 });
});
