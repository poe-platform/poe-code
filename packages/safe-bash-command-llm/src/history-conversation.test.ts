import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {toByteSource} from 'safe-bash-contracts';
import {transactSqlite} from './sqlite-transaction.js';
import {createLlmHistorySchema} from './history-schema.js';
import {withSqliteStatement} from './sqlite-statement.js';
import {historyConversationName,writeLlmHistoryConversation} from './history-conversation.js';
const signal=new AbortController().signal;
test('streamed conversation names match pinned Python whitespace and codepoint truncation',async()=>{
 const cases=[['',''],['  alpha\n\t beta  ',' alpha beta '],['a'.repeat(32),'a'.repeat(32)],['a'.repeat(33),'a'.repeat(31)+'…'],['😀'.repeat(32),'😀'.repeat(32)],['😀'.repeat(33),'😀'.repeat(31)+'…'],['\x1c\x85alpha\u2003\u3000beta',' alpha beta'],['\ufeffalpha\u200bbeta','\ufeffalpha\u200bbeta'],[' '.repeat(100000)+'end',' end']];
 for(const [input,expected]of cases){
  const bytes=new TextEncoder().encode(input!);
  assert.equal(await historyConversationName((async function*(){for(let offset=0;offset<bytes.length;offset+=7)yield bytes.subarray(offset,offset+7);})(),signal),expected);
 }
});
test('a complete truncated name closes the source without reading the rest of a large prompt',async()=>{
 let closed=false;
 const input=(async function*(){try{yield new TextEncoder().encode('x'.repeat(33));assert.fail('unneeded suffix read');}finally{closed=true;}})();
 assert.equal(await historyConversationName(input,signal),'x'.repeat(31)+'…');assert.equal(closed,true);
});
test('conversation insert-ignore preserves the first name and model',async()=>{
 const fs=new MemoryFileSystem();
 await transactSqlite({fs,path:'/logs.db',signal,maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:64},async s=>{
  await createLlmHistorySchema(s,signal,'2026-10-02');
  await writeLlmHistoryConversation(s,{id:'c',model:'first',nameSource:toByteSource('original\nname')},signal);
  await writeLlmHistoryConversation(s,{id:'c',model:'second',nameSource:toByteSource('replacement')},signal);
  await withSqliteStatement(s.module,{...s,signal,sql:'SELECT id,name,model FROM conversations'},async q=>{for await(const row of q.rows([],['text','text','text']))assert.deepEqual(row,['c','original name','first']);});
 });
});

test('cancellation interrupts pending or whitespace-only names and closes their sources',async()=>{
 for(const pending of [true,false]){
  const controller=new AbortController();let started!:()=>void,closed=0;
  const ready=new Promise<void>(resolve=>{started=resolve;});
  const source={ [Symbol.asyncIterator](){return {next(){started();return pending?new Promise<IteratorResult<Uint8Array>>(()=>{}):Promise.resolve({done:false as const,value:new Uint8Array(1048576).fill(32)});},async return(){closed++;return {done:true as const,value:undefined};}};}};
  const result=historyConversationName(source,controller.signal);await ready;
  if(pending)controller.abort(new Error('cancel name'));
  else setTimeout(()=>controller.abort(new Error('cancel whitespace')),0);
  await assert.rejects(result);assert.equal(closed,1);
 }
});
