import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {toByteSource,type CommandContext} from 'safe-bash-contracts';
import {createLlmCommand} from './command.js';
import type {LlmFragmentLoader} from './fragment-loaders.js';
import type {LlmTemplateLoader} from './templates.js';

function fixture(){
 const calls:string[]=[];
 const fragments=(prefix:string):LlmFragmentLoader=>{calls.push('resolve fragment '+prefix);return async function*(value){yield {type:'text',source:{bytes:toByteSource('fragment '+value),async dispose(){}}};};};
 const templates=(prefix:string):LlmTemplateLoader=>{calls.push('resolve template '+prefix);return value=>({name:prefix,prompt:'template '+value+' $input'});};
 const command=createLlmCommand({loaderProvider:{fragments,templates,async discover(context){
  calls.push('discover '+context.kind);context.admitBytes?.(5);
  return {fragmentLoaders:new Map([['native',Object.assign(async function*(){},{description:'Native fragment'})]]),templateLoaders:new Map([['native',Object.assign(()=>({name:'native'}),{description:'Native template'})]])};
 }},defaultModel:'fixture',providers:[{name:'fixture',models:[{id:'fixture'}],async *complete(request){yield request.prompt;}}]});
 return {calls,async run(args:string[]){let stdout='',stderr='';const result=await command.execute({command:'llm',args,fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,stdin:toByteSource(''),stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}});return {...result,stdout,stderr};}};
}
for(const kind of ['fragments','templates'])test('lazy '+kind+' discovery runs once per listing and never for help/errors',async()=>{
 const f=fixture();
 for(const args of [[kind,'loaders','--help'],[kind,'loaders','--invalid']])await f.run(args);
 assert.deepEqual(f.calls,[]);
 const first=await f.run([kind,'loaders']);assert.equal(first.exitCode,0,first.stderr);assert.match(first.stdout,/native:/);
 await f.run([kind,'loaders']);assert.deepEqual(f.calls,['discover '+kind,'discover '+kind]);
});
test('fragment invocation resolves without an extra discovery pass',async()=>{
 const f=fixture(),result=await f.run(['-f','native:hello','question']);
 assert.equal(result.exitCode,0,result.stderr);assert.equal(result.stdout,'fragment hello\nquestion\n');assert.deepEqual(f.calls,['resolve fragment native']);
});
test('template invocation resolves without an extra discovery pass',async()=>{
 const f=fixture(),result=await f.run(['-t','native:hello','question']);
 assert.equal(result.exitCode,0,result.stderr);assert.equal(result.stdout,'template hello question\n');assert.deepEqual(f.calls,['resolve template native']);
});

test('lazy discovery metadata participates in the invocation materialization budget',async()=>{
 let stdout='',stderr='';
 const command=createLlmCommand({limits:{maxBufferedInputBytes:64},loaderProvider:{fragments(){assert.fail('listing resolved a fragment');},templates(){assert.fail('listing resolved a template');},async discover(context){
  assert.ok(context.maxBytes<=64);context.admitBytes!(65);assert.fail('metadata overrun was accepted');
 }}});
 const result=await command.execute({command:'llm',args:['fragments','loaders'],fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,stdin:toByteSource(''),stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}});
 assert.equal(result.exitCode,1);assert.equal(stdout,'');assert.match(stderr,/buffered input byte limit/);
});
test('explicit loader maps override discovered names and bypass dynamic resolution',async()=>{
 let discoveries=0;
 const explicit:LlmTemplateLoader=Object.assign(()=>({name:'native',prompt:'explicit'}),{description:'Explicit template'});
 const command=createLlmCommand({defaultModel:'fixture',providers:[{name:'fixture',models:[{id:'fixture'}],async *complete(request){yield request.prompt;}}],templateLoaders:new Map([['native',explicit]]),loaderProvider:{fragments(){assert.fail();},templates(){assert.fail('explicit template used dynamic resolver');},async discover(){discoveries++;return {fragmentLoaders:new Map(),templateLoaders:new Map([['native',Object.assign(()=>({name:'native'}),{description:'Discovered template'})]])};}}});
 let stdout='';const context:CommandContext={command:'llm',args:['templates','loaders'],fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,stdin:toByteSource(''),stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(){}}};const result=await command.execute(context);
 assert.equal(result.exitCode,0);assert.equal(stdout,'native:\n  Explicit template\n');assert.equal(discoveries,1);
 stdout='';assert.equal((await command.execute({...context,args:['-t','native:value']})).exitCode,0);assert.equal(stdout,'explicit\n');assert.equal(discoveries,1);
});
