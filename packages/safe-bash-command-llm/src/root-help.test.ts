import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createLlmCommand} from './command.js';
import reference from './fixtures/root-help-0.27.1.json' with {type:'json'};

// History is host-owned; these commands expose only stateless schema/loader operations.
function stateless(text:string):string {
 return text.split('\n').filter(line=>!line.startsWith('  logs ')).join('\n')
  .replace('Manage fragments that are stored in the database','Show fragment loaders registered by plugins')
  .replace('Manage stored schemas','Convert schema definitions');
}
for(const row of reference.cases)test(`native stateless root help ${JSON.stringify(row.args)}`,async()=>{
 let stdout='',stderr='';
 const result=await createLlmCommand().execute({command:'llm',args:row.args,fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,
 stdin:{[Symbol.asyncIterator](){return assert.fail('root help acquired stdin');}},
 stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}});
 assert.equal(result.exitCode,row.exitCode);
 assert.equal(stdout,stateless(row.output));assert.equal(stderr,'');
});
