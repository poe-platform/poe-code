import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createLlmCommand} from './command.js';
import clusters from './fixtures/prompt-clusters-0.27.1.json' with {type:'json'};
import fixtures from './fixtures/prompt-arity-0.27.1.json' with {type:'json'};

for(const fixture of fixtures)test(`pinned prompt argument arity ${fixture.args.join(' ')}`,async()=>{
 let out='',err='',calls=0;
 const command=createLlmCommand({defaultModel:'fixture',providers:[{name:'fixture',models:[{id:'fixture'}],async *complete(){calls++;yield 'unexpected';}}]});
 const result=await command.execute({command:'llm',args:fixture.args,fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,stdin:{[Symbol.asyncIterator](){throw new Error('must not acquire stdin for invalid arguments');}},stdout:{async write(bytes){out+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){err+=new TextDecoder().decode(bytes);}}});
 assert.equal(result.exitCode,fixture.code,err);assert.equal(out,fixture.out);assert.equal(err,fixture.err);assert.equal(calls,0);
});

for(const fixture of clusters)test(`pinned prompt cluster request ${fixture.args.join(' ')}`,async()=>{
 let out='',err='';const calls:unknown[]=[];
 const command=createLlmCommand({providers:[{name:'fixture',models:[{id:'fixture',options:{label:{type:'string'}}}],async *complete(request){calls.push({prompt:request.prompt,system:request.system??null,options:request.options,stream:request.stream});yield '```text\nanswer\n```';}}]});
 const result=await command.execute({command:'llm',args:fixture.args,fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,stdin:{async *[Symbol.asyncIterator](){}},stdout:{async write(bytes){out+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){err+=new TextDecoder().decode(bytes);}}});
 assert.equal(result.exitCode,fixture.code,err);assert.equal(out,fixture.out);assert.equal(err,fixture.err);assert.deepEqual(JSON.parse(JSON.stringify(calls)),fixture.calls);
});
