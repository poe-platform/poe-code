import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { toByteSource } from 'safe-bash-contracts';
import { createLlmCommand } from './command.js';
import fixture from './fixtures/schema-list-0.27.1.json' with {type:'json'};

async function setup() {
 const fs=new MemoryFileSystem();await fs.mkdir('/out');
 await fs.writeFile('/out/logs.db',inflateSync(Buffer.from(fixture.databaseZlib,'base64')));
 return {fs,cwd:'/',env:{LLM_USER_PATH:'/out'},signal:new AbortController().signal};
}

test('schema listing matches pinned CLI summary, search, JSON and usage errors',async()=>{
 for(const expected of fixture.cases){
  const context=await setup();let stdout='',stderr='';
  const result=await createLlmCommand({providers:[]}).execute({...context,command:'llm',args:expected.args,stdin:toByteSource(''),stdout:{async write(b){stdout+=new TextDecoder().decode(b);}},stderr:{async write(b){stderr+=new TextDecoder().decode(b);}}});
  assert.equal(result.exitCode,expected.exitCode,JSON.stringify(expected.args)+stderr);
  assert.equal(stdout,expected.stdout,JSON.stringify(expected.args));assert.equal(stderr,expected.stderr,JSON.stringify(expected.args));
 }
});

test('SDK schema usage visits preserve ordering, raw text and bounded reads',async()=>{
 const {visitLlmStoredSchemas}=await import('./history-schema-list.js');
 const context=await setup();
 const rows: Array<{id:string;timesUsed:bigint;recentlyUsed:string|null}>=[];
 await visitLlmStoredSchemas(context,{},async row=>{rows.push(row);});
 assert.deepEqual(rows.map(({id,timesUsed,recentlyUsed})=>({id,timesUsed,recentlyUsed})),[
  {id:'scalar',timesUsed:1n,recentlyUsed:null},{id:'nested',timesUsed:1n,recentlyUsed:'2025-02-01'},{id:'one',timesUsed:2n,recentlyUsed:'2025-03-01'}
 ]);
 await context.fs.writeFile('/out/logs.db',inflateSync(Buffer.from(fixture.largeDatabaseZlib,'base64')));
 let largest=0,total=0,count=0;
 await visitLlmStoredSchemas(context,{queries:['description'],maxBytes:500000,admitBytes(size){largest=Math.max(largest,size);total+=size;}},async row=>{
  count++;assert.equal(row.id,'large');assert.equal(JSON.parse(row.content).description,'é'.repeat(70000));
 });
 assert.equal(count,1);assert.ok(total>65536);assert.ok(largest<=16384);
 assert.deepEqual((await context.fs.readdir('/out')).map(entry=>entry.name),['logs.db']);
});

test('schema usage consumer failure, byte admission and cancellation preserve canonical state',async()=>{
 const {visitLlmStoredSchemas}=await import('./history-schema-list.js');
 for(const failure of ['consumer','limit','cancel']){
  const context=await setup(),abort=new AbortController();
  const before=await context.fs.readFile('/out/logs.db');let visits=0;
  await assert.rejects(visitLlmStoredSchemas({...context,signal:abort.signal},{maxBytes:failure==='limit'?1:10000},async()=>{
   visits++;if(failure==='cancel')abort.abort();else throw new Error('consumer failed');
  }));
  assert.equal(visits,failure==='limit'?0:1);
  assert.deepEqual(await context.fs.readFile('/out/logs.db'),before);
  assert.deepEqual((await context.fs.readdir('/out')).map(entry=>entry.name),['logs.db']);
 }
});
