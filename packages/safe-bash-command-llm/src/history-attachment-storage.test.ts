import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {toByteSource} from 'safe-bash-contracts';
import {transactSqlite} from './sqlite-transaction.js';
import {createLlmHistorySchema} from './history-schema.js';
import {withSqliteStatement} from './sqlite-statement.js';
import {writeLlmHistoryAttachments} from './history-attachments.js';
const signal=new AbortController().signal;
const options=(fs:MemoryFileSystem)=>({fs,path:'/logs.db',signal,maxFileBytes:4*1048576,maxIndexBytes:1048576,maxOpenFiles:64});
test('history attachments preserve binary content, NULL versus empty content, replacement and ordered owner links',async()=>{
 const fs=new MemoryFileSystem();
 await transactSqlite(options(fs),async s=>{
  await createLlmHistorySchema(s,signal,'2026-10-02');
  await writeLlmHistoryAttachments(s,{responseId:'r1'},(async function*(){
   yield {id:'binary',type:'application/octet-stream',content:{size:100000,bytes:(async function*(){for(let i=0;i<100;i++)yield new Uint8Array(1000).fill(i);})()}};
   yield {id:'path',path:'/source.png',type:'image/png'};
   yield {id:'empty',type:'application/octet-stream',content:{size:0,bytes:toByteSource('')}};
  })(),signal);
  await writeLlmHistoryAttachments(s,{toolResultId:7n},(async function*(){yield {id:'path',url:'https://example.test/image',type:'image/webp'};})(),signal);
  await withSqliteStatement(s.module,{...s,signal,sql:"SELECT length(content),hex(substr(content,1,1)),hex(substr(content,-1,1)) FROM attachments WHERE id='binary'"},async q=>{for await(const row of q.rows([],['integer','text','text']))assert.deepEqual(row,[100000n,'00','63']);});
  await withSqliteStatement(s.module,{...s,signal,sql:"SELECT typeof(content) FROM attachments WHERE id IN ('empty','path') ORDER BY id"},async q=>{const rows=[];for await(const row of q.rows([],['text']))rows.push(row);assert.deepEqual(rows,[['blob'],['null']]);});
  await withSqliteStatement(s.module,{...s,signal,sql:'SELECT attachment_id,"order" FROM prompt_attachments WHERE response_id=? ORDER BY "order"'},async q=>{const rows=[];for await(const row of q.rows(['r1'],['text','integer']))rows.push(row);assert.deepEqual(rows,[['binary',0n],['path',1n],['empty',2n]]);});
  await withSqliteStatement(s.module,{...s,signal,sql:'SELECT tool_result_id,attachment_id,"order" FROM tool_results_attachments'},async q=>{for await(const row of q.rows([],['integer','text','integer']))assert.deepEqual(row,[7n,'path',0n]);});
 });
});

test('failed attachment replacement rolls back bytes and prior links even if caught',async()=>{
 const fs=new MemoryFileSystem();
 await transactSqlite(options(fs),async s=>{
  await createLlmHistorySchema(s,signal,'2026-10-02');
  await s.execute("INSERT INTO attachments(id,type,content) VALUES('a','old',X'616263')");
  await assert.rejects(writeLlmHistoryAttachments(s,{responseId:'r'},(async function*(){
   yield {id:'first',content:{size:1,bytes:toByteSource('x')}};
   yield {id:'a',type:'new',content:{size:5,bytes:toByteSource('bad')}};
  })(),signal));
  await withSqliteStatement(s.module,{...s,signal,sql:'SELECT id,type,hex(content) FROM attachments'},async q=>{const rows=[];for await(const row of q.rows([],['text','text','text']))rows.push(row);assert.deepEqual(rows,[['a','old','616263']]);});
  await withSqliteStatement(s.module,{...s,signal,sql:'SELECT count(*) FROM prompt_attachments'},async q=>{for await(const row of q.rows([],['integer']))assert.deepEqual(row,[0n]);});
 });
});

test('duplicate owner links preserve reference errors and roll back the whole attachment batch',async()=>{
 const fs=new MemoryFileSystem();
 await transactSqlite(options(fs),async s=>{
  await createLlmHistorySchema(s,signal,'2026-10-02');
  await assert.rejects(writeLlmHistoryAttachments(s,{responseId:'r'},(async function*(){yield {id:'same'};yield {id:'same'};})(),signal));
  await withSqliteStatement(s.module,{...s,signal,sql:'SELECT count(*) FROM attachments'},async q=>{for await(const row of q.rows([],['integer']))assert.deepEqual(row,[0n]);});
 });
});

test('cancelling a pending attachment source retires it and preserves canonical history',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite(options(fs),s=>createLlmHistorySchema(s,signal,'2026-10-02'));
 const before=await fs.readFile('/logs.db');const controller=new AbortController();let ready!:()=>void,closed=0;
 const started=new Promise<void>(resolve=>{ready=resolve;});
 const source={ [Symbol.asyncIterator](){return {next(){ready();return new Promise<IteratorResult<Uint8Array>>(()=>{});},async return(){closed++;return {done:true as const,value:undefined};}};}};
 const pending=transactSqlite({...options(fs),signal:controller.signal},s=>writeLlmHistoryAttachments(s,{responseId:'r'},(async function*(){yield {id:'pending',content:{size:1,bytes:source}};})(),controller.signal));
 await started;controller.abort(new Error('cancel attachment'));
 await assert.rejects(pending);assert.equal(closed,1);assert.deepEqual(await fs.readFile('/logs.db'),before);
 assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['logs.db']);
});
