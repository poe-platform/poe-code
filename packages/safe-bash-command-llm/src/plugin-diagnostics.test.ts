import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {toByteSource} from 'safe-bash-contracts';
import {createLlmCommand} from './command.js';
import reference from './fixtures/plugin-diagnostics-reference.json' with {type:'json'};

const message = reference.message.unit.repeat(reference.message.repetitions) + reference.message.suffix;
const loader = () => { throw new Error(message); };
function command() {
 return createLlmCommand({
  templateLoaders:new Map([['native',loader]]), fragmentLoaders:new Map([['native',loader]]),
  defaultModel:'fixture', providers:[{name:'fixture',models:[{id:'fixture'}],async *complete(){assert.fail('loader failure must precede provider execution');yield '';}}],
 });
}
for(const fixture of reference.cases)test(`complete ${fixture.args[0]} failure matches pinned native CLI in bounded writes`,async()=>{
 let stdout='',stderr='',writes=0;
 const decoder=new TextDecoder('utf-8',{fatal:true});
 const result=await command().execute({
  command:'llm',args:fixture.args,fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,
  stdin:toByteSource(''),stdout:{async write(bytes){stdout+=decoder.decode(bytes);}},
  stderr:{async write(bytes){assert.ok(bytes.length<=16384);writes++;stderr+=decoder.decode(bytes);}},
 });
 assert.equal(result.exitCode,fixture.exitCode);
 assert.equal(stdout,fixture.stdout);
 assert.equal(stderr,fixture.stderrPrefix+message+fixture.stderrSuffix);
 assert.ok(writes>1);
});

test('large plugin diagnostics await each sink write and stop on cancellation',async()=>{
 const controller=new AbortController();
 const reason=new Error('stop diagnostic');
 let writes=0;
 await assert.rejects(async()=>command().execute({
  command:'llm',args:reference.cases[0]!.args,fs:new MemoryFileSystem(),cwd:'/',env:{},signal:controller.signal,
  stdin:toByteSource(''),stdout:{async write(){assert.fail('unexpected output');}},
  stderr:{async write(bytes){assert.ok(bytes.length<=16384);writes++;await Promise.resolve();controller.abort(reason);}},
 }),error=>error===reason);
 assert.equal(writes,1);
});
