import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {toByteSource} from 'safe-bash-contracts';
import {persistLlmHistoryResponse} from './history-persistence.js';
import {transactSqlite} from './sqlite-transaction.js';
import {withSqliteStatement,type SqliteColumn} from './sqlite-statement.js';

const signal=new AbortController().signal;
const options=(fs:MemoryFileSystem)=>({fs,path:'/logs.db',signal,maxFileBytes:2097152,maxIndexBytes:1048576,maxOpenFiles:64});
async function rows(fs:MemoryFileSystem,sql:string,columns:SqliteColumn[]){
 return (await transactSqlite(options(fs),s=>withSqliteStatement(s.module,{...s,signal,sql},async q=>{
  const result=[];for await(const row of q.rows([],columns))result.push(row);return result;
 }))).value;
}
const input=()=>({
 response:{id:'response',model:'fixture',prompt:'alpha beta',response:'gamma answer'},
 conversation:{id:'conversation',model:'fixture',nameSource:toByteSource('alpha alpha alpha beta')},
 schemaJson:'{"type":"string"}',
 fragments:(async function*(){
  yield {kind:'prompt' as const,content:()=>toByteSource('alpha'),source:'file:a'};
  yield {kind:'system' as const,content:()=>toByteSource('beta')};
  yield {kind:'prompt' as const,content:()=>toByteSource('alpha'),source:'ignored'};
 })(),
 attachments:(async function*(){yield {id:'attachment',type:'image/png',content:{size:3,bytes:toByteSource(Uint8Array.of(0,255,1))}};})(),
});
test('history composition publishes migrated response, FTS, schema, attachments and ordered fragment links together',async()=>{
 const fs=new MemoryFileSystem();
 const receipt=await persistLlmHistoryResponse(options(fs),input());
 assert.ok(receipt.committed);assert.deepEqual(receipt.cleanupErrors,[]);
 assert.deepEqual(await rows(fs,'SELECT id,name,model FROM conversations',['text','text','text']),[['conversation','alpha alpha alpha beta','fixture']]);
 assert.deepEqual(await rows(fs,'SELECT r.id,r.conversation_id,s.content FROM responses r JOIN schemas s ON r.schema_id=s.id',['text','text','text']),[['response','conversation','{"type":"string"}']]);
 assert.deepEqual(await rows(fs,'SELECT f.content,p."order",f.source FROM prompt_fragments p JOIN fragments f ON p.fragment_id=f.id ORDER BY p."order"',['text','integer','text']),[['alpha',0n,'file:a'],['alpha',1n,'file:a']]);
 assert.deepEqual(await rows(fs,'SELECT f.content,p."order" FROM system_fragments p JOIN fragments f ON p.fragment_id=f.id',['text','integer']),[['beta',0n]]);
 assert.deepEqual(await rows(fs,"SELECT count(*) FROM responses_fts WHERE responses_fts MATCH 'gamma'",['integer']),[[1n]]);
 assert.deepEqual(await rows(fs,'SELECT hex(content) FROM attachments',['text']),[['00FF01']]);
 assert.deepEqual(await rows(fs,'PRAGMA foreign_key_check',['text','integer','text','integer']),[]);
 assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['logs.db']);
});
test('a late fragment replay failure preserves the entire previously published history',async()=>{
 const fs=new MemoryFileSystem();await persistLlmHistoryResponse(options(fs),input());
 const before=await fs.readFile('/logs.db');let pass=0;
 const next=input();next.response.id='later';
 const fragments=(async function*(){yield {kind:'prompt' as const,content:()=>toByteSource(++pass===1?'first':'other')};})();
 await assert.rejects(persistLlmHistoryResponse(options(fs),{...next,fragments}),/changed/);
 assert.deepEqual(await fs.readFile('/logs.db'),before);
 assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['logs.db']);
});

test('fragment iteration advances only after the prior native TEXT rewrite completes',async()=>{
 const fs=new MemoryFileSystem();let replays=0;
 const fragments=(async function*(){
  for(let i=0;i<12;i++){
   assert.equal(replays,i*2);
   yield {kind:'prompt' as const,content:()=>({async *[Symbol.asyncIterator](){
    yield new TextEncoder().encode('fragment '+i);replays++;
   }})};
  }
 })();
 const value=input();
 await persistLlmHistoryResponse(options(fs),{...value,fragments});
 assert.equal(replays,24);
 assert.deepEqual(await rows(fs,'SELECT count(*) FROM prompt_fragments',['integer']),[[12n]]);
});
test('cancellation during fragment acquisition closes its iterator and leaves canonical history unchanged',async()=>{
 const fs=new MemoryFileSystem();await persistLlmHistoryResponse(options(fs),input());
 const before=await fs.readFile('/logs.db');
 let entered!:()=>void,closed=0;
 const ready=new Promise<void>(resolve=>{entered=resolve;});
 const controller=new AbortController();
 const fragments={ [Symbol.asyncIterator](){return {
  next(){entered();return new Promise<IteratorResult<never>>(()=>{});},
  async return(){closed++;return {done:true as const,value:undefined};},
 };}};
 const value=input();value.response.id='cancelled';
 const pending=persistLlmHistoryResponse({...options(fs),signal:controller.signal},{...value,fragments});
 await ready;controller.abort(new Error('cancel history'));
 await assert.rejects(pending,/cancel history/);
 assert.equal(closed,1);assert.deepEqual(await fs.readFile('/logs.db'),before);
 assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['logs.db']);
});
test('response append preserves first conversation metadata and does not require fragments or schema',async()=>{
 const fs=new MemoryFileSystem();await persistLlmHistoryResponse(options(fs),input());
 await persistLlmHistoryResponse(options(fs),{
  response:{id:'second',model:'another',prompt:'later',response:'second answer'},
  conversation:{id:'conversation',model:'another',nameSource:toByteSource('later')},
 });
 assert.deepEqual(await rows(fs,'SELECT name,model FROM conversations',['text','text']),[['alpha alpha alpha beta','fixture']]);
 assert.deepEqual(await rows(fs,"SELECT id,schema_id FROM responses WHERE id='second'",['text','null']),[['second',null]]);
 assert.deepEqual(await rows(fs,"SELECT count(*) FROM responses_fts WHERE responses_fts MATCH 'answer'",['integer']),[[2n]]);
});
test('a committed history write returns cleanup errors without hiding its publication receipt',async()=>{
 const backing=new MemoryFileSystem();let injected=0;
 const fs=new Proxy(backing,{get(target,key){
  if(key==='createStagedFile')return async(...args:Parameters<typeof backing.createStagedFile>)=>{
   const stage=await target.createStagedFile(...args);
   if(args[1]!=='database')return stage;
   const cleanup=stage.cleanup!;
   return {...stage,cleanup:{...cleanup,remove:cleanup.remove.bind(cleanup),
    async close(){await cleanup.close();injected++;throw new Error('retirement failed');},
   }};
  };
  const value:unknown=Reflect.get(target,key);
  return typeof value==='function'?value.bind(target):value;
 }});
 const receipt=await persistLlmHistoryResponse(options(fs),input());
 assert.equal(receipt.value,'response');assert.ok(receipt.committed);
 assert.equal(injected,1);assert.equal(receipt.cleanupErrors.length,1);
 assert.match(String(receipt.cleanupErrors[0]),/retirement failed/);
 assert.deepEqual(await rows(backing,'SELECT id FROM responses',['text']),[['response']]);
});

test('tool definitions and response links participate in the same atomic history publication',async()=>{
 const fs=new MemoryFileSystem();
 const tools=()=>({async *[Symbol.asyncIterator](){yield {name:'lookup',inputSchemaJson:'{"type":"object"}'};}});
 await persistLlmHistoryResponse(options(fs),{...input(),tools:tools()});
 const second=input();second.response.id='second';
 await persistLlmHistoryResponse(options(fs),{...second,tools:tools()});
 assert.deepEqual(await rows(fs,'SELECT name,input_schema FROM tools',['text','text']),[['lookup','{"type": "object"}']]);
 assert.deepEqual(await rows(fs,'SELECT tool_id,response_id FROM tool_responses ORDER BY response_id',['integer','text']),[[1n,'response'],[1n,'second']]);
 const before=await fs.readFile('/logs.db');
 const third=input();third.response.id='third';
 const failed={async *[Symbol.asyncIterator](){yield {name:'other',inputSchemaJson:'{}'};throw new Error('tool source failed');}};
 await assert.rejects(persistLlmHistoryResponse(options(fs),{...third,tools:failed}),/tool source failed/);
 assert.deepEqual(await fs.readFile('/logs.db'),before);
});
test('calls and results resolve the last supplied tool with a matching name and persist result attachments',async()=>{
 const fs=new MemoryFileSystem();
 const tools={async *[Symbol.asyncIterator](){
  yield {name:'lookup',description:'first',inputSchemaJson:'{}'};
  yield {name:'lookup',description:'last',inputSchemaJson:'{}'};
 }};
 const source=(value:string)=>{const bytes=new TextEncoder().encode(value);return {size:bytes.length,bytes:toByteSource(bytes)};};
 const toolCalls={async *[Symbol.asyncIterator](){
  yield {name:'lookup',toolCallId:'call',arguments:source('{"query": "test"}')};
  yield {name:'missing',arguments:source('{}')};
 }};
 const toolResults={async *[Symbol.asyncIterator](){yield {
  name:'lookup',toolCallId:'call',output:source('é'.repeat(40000)),exception:'ValueError: example',
  instance:{name:'lookup',plugin:'fixture',arguments:source('{"mode": "read"}')},
  attachments:{async *[Symbol.asyncIterator](){yield {id:'result-file',content:{size:2,bytes:toByteSource(Uint8Array.of(7,9))}};}},
 };}};
 await persistLlmHistoryResponse(options(fs),{...input(),tools,toolCalls,toolResults});
 assert.deepEqual(await rows(fs,"SELECT name,COALESCE(tool_id,-1) FROM tool_calls ORDER BY id",['text','integer']),[['lookup',2n],['missing',-1n]]);
 assert.deepEqual(await rows(fs,'SELECT tool_id,length(output),instance_id,exception FROM tool_results',['integer','integer','integer','text']),[[2n,40000n,1n,'ValueError: example']]);
 assert.deepEqual(await rows(fs,'SELECT plugin,name,arguments FROM tool_instances',['text','text','text']),[['fixture','lookup','{"mode": "read"}']]);
 assert.deepEqual(await rows(fs,'SELECT a.id,hex(a.content),l."order" FROM tool_results_attachments l JOIN attachments a ON l.attachment_id=a.id',['text','text','integer']),[['result-file','0709',0n]]);
 assert.deepEqual(await rows(fs,"SELECT name FROM sqlite_schema WHERE name GLOB 'llm_pending*'",['text']),[]);
 assert.deepEqual(await rows(fs,'PRAGMA foreign_key_check',['text','integer','text','integer']),[]);
});
test('tool lookup follows response-local declaration order when stored IDs are reversed',async()=>{
 const fs=new MemoryFileSystem();
 const tools=(reverse:boolean)=>({async *[Symbol.asyncIterator](){
  for(const description of reverse?['last','first']:['first','last'])yield {name:'lookup',description,inputSchemaJson:'{}'};
 }});
 await persistLlmHistoryResponse(options(fs),{...input(),tools:tools(false)});
 const second=input();second.response.id='second';
 const calls={async *[Symbol.asyncIterator](){yield {name:'lookup',arguments:{size:2,bytes:toByteSource('{}')}};}};
 await persistLlmHistoryResponse(options(fs),{...second,tools:tools(true),toolCalls:calls});
 assert.deepEqual(await rows(fs,'SELECT tool_id FROM tool_calls',['integer']),[[1n]]);
});
test('cancelling a result payload retires its source and rolls back its instance and attachments',async()=>{
 const fs=new MemoryFileSystem();await persistLlmHistoryResponse(options(fs),input());const before=await fs.readFile('/logs.db');
 const controller=new AbortController();let ready!:()=>void,closed=0;
 const started=new Promise<void>(resolve=>{ready=resolve;});
 const bytes={ [Symbol.asyncIterator](){return {next(){ready();return new Promise<IteratorResult<Uint8Array>>(()=>{});},async return(){closed++;return {done:true as const,value:undefined};}};}};
 const results={async *[Symbol.asyncIterator](){yield {
  name:'lookup',output:{size:1,bytes},instance:{name:'lookup',arguments:{size:2,bytes:toByteSource('{}')}},
  attachments:{async *[Symbol.asyncIterator](){yield {id:'unpublished',content:{size:1,bytes:toByteSource(Uint8Array.of(1))}};}},
 };}};
 const next=input();next.response.id='cancelled';
 const pending=persistLlmHistoryResponse({...options(fs),signal:controller.signal},{...next,toolResults:results});
 await started;controller.abort(new Error('cancel result'));await assert.rejects(pending);
 assert.equal(closed,1);assert.deepEqual(await fs.readFile('/logs.db'),before);
 assert.deepEqual((await fs.readdir('/')).map(entry=>entry.name),['logs.db']);
});
