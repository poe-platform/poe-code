import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createLlmCommand} from './command.js';
import {createLlmConfiguration} from './configuration.js';
const signal=new AbortController().signal;
const command=createLlmCommand({providers:[{name:'Fixture',models:[
 {id:'text-model'},
 {id:'embed-small',aliases:['es'],capabilities:['embed']},
 {id:'embed-large',aliases:['el'],capabilities:['embed']},
],complete(){throw new Error('must not invoke completion');},async embed(){throw new Error('must not invoke embedding');}}]});
async function run(fs:MemoryFileSystem,args:string[],selected=command){
 const stdout:Uint8Array[]=[],stderr:Uint8Array[]=[];
 const result=await selected.execute({command:'llm',args:['embed-models',...args],fs,cwd:'/',env:{LLM_USER_PATH:'/config'},signal,
  stdin:{[Symbol.asyncIterator](){throw new Error('must not acquire stdin');}},
  stdout:{async write(bytes){stdout.push(bytes.slice());}},stderr:{async write(bytes){stderr.push(bytes.slice());}},
 });
 return {code:result.exitCode,stdout:Buffer.concat(stdout).toString(),stderr:Buffer.concat(stderr).toString()};
}
test('embedding model management matches pinned llm 0.27.1',async()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/embed-models-0.27.1.json',import.meta.url),'utf8')) as {cases:{args:string[];code:number;stdout:string;stderr:string}[]};
 const fs=new MemoryFileSystem();
 for(const {args,...expected} of fixture.cases){
  expected.stdout=expected.stdout.replaceAll('cli embed-models','llm embed-models');
  expected.stderr=expected.stderr.replaceAll('cli embed-models','llm embed-models');
  assert.deepEqual(await run(fs,args),expected,JSON.stringify(args));
 }
});
test('embedding defaults use canonical configuration and do not change the text default',async()=>{
 const fs=new MemoryFileSystem();
 const configuration=createLlmConfiguration({fs,cwd:'/',env:{LLM_USER_PATH:'/config'},signal});
 await configuration.setDefaultModel('text-model');await configuration.setAlias('vectors','embed-large');
 assert.equal((await run(fs,['default','vectors'])).code,0);
 assert.equal(await configuration.defaultModel('default_embedding_model.txt'),'embed-large');
 assert.equal(await configuration.defaultModel(),'text-model');
 assert.equal((await run(fs,['list','-q','vectors'])).stdout,'Fixture: embed-large (aliases: el, vectors)\n');
 assert.deepEqual(await run(fs,['default','text-model']),{code:1,stdout:'',stderr:'Error: Unknown embedding model: text-model\n'});
 assert.equal(await configuration.defaultModel('default_embedding_model.txt'),'embed-large');
});

test('source-only embedding providers can be discovered and selected as default', async () => {
 const selected=createLlmCommand({providers:[{name:'Source',models:[{id:'stream-embed',capabilities:['embed']}],complete(){throw Error('unexpected completion');},async embedSources(){throw Error('unexpected embedding');}}]});
 const fs=new MemoryFileSystem();
 assert.deepEqual(await run(fs,[],selected),{code:0,stdout:'Source: stream-embed\n',stderr:''});
 assert.equal((await run(fs,['default','stream-embed'],selected)).code,0);
 assert.equal((await run(fs,['default'],selected)).stdout,'stream-embed\n');
});
