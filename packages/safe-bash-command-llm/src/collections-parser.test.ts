import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createLlmCommand} from './command.js';
import {createLlmCollectionCommands} from './collections.js';
import reference from './fixtures/collections-parser-0.27.1.json' with {type:'json'};

for(const row of reference.cases)test(`native collection parsing: ${JSON.stringify(row.args)}`,async()=>{
 const fs=new MemoryFileSystem();let stdout='',stderr='';
 const result=await createLlmCommand({collections:createLlmCollectionCommands({maxFileBytes:1048576,maxIndexBytes:1048576,maxOpenFiles:8})}).execute({
  command:'llm',args:row.args,fs,cwd:'/',env:{LLM_USER_PATH:'/config'},signal:new AbortController().signal,
  stdin:{[Symbol.asyncIterator](){return assert.fail('collection controls acquired stdin');}},
  stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}},
 });
 assert.deepEqual({exitCode:result.exitCode,stdout,stderr},{exitCode:row.exitCode,stdout:row.stdout,stderr:row.stderr});
 assert.deepEqual(await fs.readdir('/'),[]);
});
