import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createCommandArguments,toByteSource} from 'safe-bash-contracts';
import {createLlmCommand} from './command.js';
import {shellValueFromBytes} from 'safe-bash-contracts/value';
import fixtures from './fixtures/root-routing-0.27.1.json' with {type:'json'};

for(const fixture of fixtures)test(`pinned root routing ${JSON.stringify(fixture.args)}`,async()=>{
 let out='',err='';const calls:unknown[]=[];
 const command=createLlmCommand({defaultModel:'fixture',providers:[{name:'fixture',models:[{id:'fixture'}],async *complete(request){calls.push({prompt:request.prompt,stream:request.stream});yield '```text\nanswer\n```';}}]});
 const result=await command.execute({command:'llm',args:fixture.args,fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,stdin:toByteSource(''),stdout:{async write(bytes){out+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){err+=new TextDecoder().decode(bytes);}}});
 assert.equal(result.exitCode,fixture.code,err);assert.equal(out,fixture.out);assert.equal(err,fixture.err);assert.deepEqual(calls,fixture.calls);
});

for(const malformed of [false,true])test(`root routing preserves raw byte arguments, malformed=${malformed}`,async()=>{
 const bytes=malformed?Uint8Array.of(255):new TextEncoder().encode('héllo');
 const argumentValues=createCommandArguments(['--','prompt',shellValueFromBytes(bytes)]);let prompt='';
 const command=createLlmCommand({defaultModel:'fixture',providers:[{name:'fixture',models:[{id:'fixture'}],async *complete(request){prompt=request.prompt;yield 'ok';}}]});
 const result=await command.execute({command:'llm',args:argumentValues.args,argumentValues,fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,stdin:toByteSource(''),stdout:{async write(){}},stderr:{async write(){}}});
 assert.equal(result.exitCode,malformed?1:0);assert.equal(prompt,malformed?'':'héllo');assert.deepEqual(argumentValues.bytes(2),bytes);
});
