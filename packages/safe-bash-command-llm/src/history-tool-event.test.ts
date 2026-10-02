import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {toByteSource} from 'safe-bash-contracts';
import {transactSqlite} from './sqlite-transaction.js';
import {createLlmHistorySchema} from './history-schema.js';
import {prepareLlmToolEvent} from './history-tool-event.js';
import {withSqliteStatement} from './sqlite-statement.js';
import type {SqliteFinalizer} from './sqlite-finalization.js';
const signal=new AbortController().signal;
const options=(fs:MemoryFileSystem)=>({fs,path:'/logs.db',signal,maxFileBytes:2097152,maxIndexBytes:1048576,maxOpenFiles:64});
const text=(value:string)=>{const bytes=new TextEncoder().encode(value);return {size:bytes.length,bytes:toByteSource(bytes)};};
test('native tool calls, instances and large results retain reference column types',async()=>{
 const fs=new MemoryFileSystem();const finals:((e:SqliteFinalizer)=>Promise<void>)[]=[];
 await transactSqlite({...options(fs),finalize:async e=>{for(const final of finals)await final(e);}},async s=>{
  await createLlmHistorySchema(s,signal,'2026-10-02');
  const instance=await prepareLlmToolEvent(s,{kind:'instance',plugin:'fixture',name:'lookup',arguments:text('{"mode": "read"}')},signal);finals.push(instance.finalize);
  const call=await prepareLlmToolEvent(s,{kind:'call',responseId:'response',name:'lookup',toolCallId:'call',arguments:text('{"query": "café"}')},signal);finals.push(call.finalize);
  const result=await prepareLlmToolEvent(s,{kind:'result',responseId:'response',name:'lookup',toolCallId:'call',instanceId:instance.id,output:text('é'.repeat(40000)),exception:'ValueError: example'},signal);finals.push(result.finalize);
  assert.deepEqual([instance.id,call.id,result.id],[1n,1n,1n]);
 });
 await transactSqlite(options(fs),async s=>{
  await withSqliteStatement(s.module,{...s,signal,sql:'SELECT name,arguments,tool_id FROM tool_calls'},async q=>{const rows=[];for await(const row of q.rows([],['text','text','null']))rows.push(row);assert.deepEqual(rows,[['lookup','{"query": "café"}',null]]);});
  await withSqliteStatement(s.module,{...s,signal,sql:'SELECT typeof(output),length(output),instance_id,exception FROM tool_results'},async q=>{const rows=[];for await(const row of q.rows([],['text','integer','integer','text']))rows.push(row);assert.deepEqual(rows,[['text',40000n,1n,'ValueError: example']]);});
 });
});
test('failed streamed tool results leave canonical bytes unchanged',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite(options(fs),s=>createLlmHistorySchema(s,signal,'2026-10-02'));
 const before=await fs.readFile('/logs.db');let finish!:(e:SqliteFinalizer)=>Promise<void>;
 await assert.rejects(transactSqlite({...options(fs),finalize:e=>finish(e)},async s=>{
  const record=await prepareLlmToolEvent(s,{kind:'result',responseId:'response',name:'lookup',output:{size:100,bytes:toByteSource('short')}},signal);finish=record.finalize;
 }));
 assert.deepEqual(await fs.readFile('/logs.db'),before);
 assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['logs.db']);
});
test('tool event text rejects malformed UTF-8 and unpaired scalar Unicode before publication',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite(options(fs),s=>createLlmHistorySchema(s,signal,'2026-10-02'));
 const before=await fs.readFile('/logs.db');
 for(const output of ['\ud800',{size:1,bytes:toByteSource(Uint8Array.of(255))}]){
  let finish!:(e:SqliteFinalizer)=>Promise<void>;
  await assert.rejects(transactSqlite({...options(fs),finalize:e=>finish(e)},async s=>{
   const prepared=await prepareLlmToolEvent(s,{kind:'result',responseId:'response',name:'lookup',output},signal);finish=prepared.finalize;
  }));
  assert.deepEqual(await fs.readFile('/logs.db'),before);
 }
});
test('empty tool result chunks yield to scheduled cancellation',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite(options(fs),s=>createLlmHistorySchema(s,signal,'2026-10-02'));
 const before=await fs.readFile('/logs.db'),controller=new AbortController();let count=0,closed=false,timer:ReturnType<typeof setImmediate>|undefined;
 const bytes={async *[Symbol.asyncIterator](){
  timer=setImmediate(()=>controller.abort(new Error('stop empty result')));
  try{for(;count<1024;count++)yield new Uint8Array();}finally{closed=true;}
 }};
 let finish!:(e:SqliteFinalizer)=>Promise<void>;
 try{
  await assert.rejects(transactSqlite({...options(fs),signal:controller.signal,finalize:e=>finish(e)},async s=>{
   const record=await prepareLlmToolEvent(s,{kind:'result',responseId:'response',name:'lookup',output:{size:0,bytes}},controller.signal);finish=record.finalize;
  }));
 }finally{if(timer)clearImmediate(timer);}
 assert.ok(count<1024);assert.equal(closed,true);assert.deepEqual(await fs.readFile('/logs.db'),before);
});
