import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createLlmCommand,LlmPluginExit} from 'safe-bash-command-llm';
import {toByteSource} from 'safe-bash-contracts';
import {createPythonLlmLoaderProvider} from './llm-loader-discovery.js';
for(const kind of ['fragment','template'])for(const op of ['missing','lookup'])test('native lazy '+kind+' lookup keeps '+op+' diagnostics',async()=>{
 const message=op==='missing'?'Unknown '+kind+' prefix: missing':kind+' registration failed';
 let executions=0;const capability=kind==='fragment'?'llm_fragments':'llm_templates';
 const loaderProvider=createPythonLlmLoaderProvider({createExecutor:()=>({terminate(){},async run(start){
  executions++;start.onReady();const send=(value:any)=>start.host!.request({version:1,operation:'call',capability,value});
  assert.equal((await send({op:'request'}) as any).prefix,'missing');
  await send({op,message});return 0;
 }})});
 const command=createLlmCommand({loaderProvider,defaultModel:'fixture',providers:[{name:'fixture',models:[{id:'fixture'}],async *complete(){yield assert.fail('lookup failure called model');}}]});
 let stdout='',stderr='';
 const result=await command.execute({command:'llm',args:[kind==='fragment'?'-f':'-t','missing:value','question'],fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,stdin:toByteSource(''),stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}});
 assert.equal(result.exitCode,1);assert.equal(stdout,'');assert.equal(stderr,'Error: '+message+'\n');assert.equal(executions,1);
});

for(const kind of ['fragment','template','fragment-discovery','template-discovery'])for(const exitCode of [0,7])test(`native ${kind} plugin exit ${exitCode} survives command cleanup`,async()=>{
 let retired=0;
 const capability=kind.endsWith('-discovery')?'llm_loaders':kind==='fragment'?'llm_fragments':'llm_templates';
 const loaderProvider=createPythonLlmLoaderProvider({createExecutor:()=>({terminate(){retired++;},async run(start){
  start.onReady();await start.host!.request({version:1,operation:'call',capability,value:{op:'exit'}});return exitCode;
 }})});
 const command=createLlmCommand({loaderProvider,defaultModel:'fixture',providers:[{name:'fixture',models:[{id:'fixture'}],complete(){throw new Error('plugin exit called model');}}]});
 const fs=new MemoryFileSystem();let stdout='',stderr='';
 const result=await command.execute({command:'llm',args:kind.endsWith('-discovery')?[kind.startsWith('fragment')?'fragments':'templates','loaders']:[kind==='fragment'?'-f':'-t','native:value','question'],fs,cwd:'/',env:{},signal:new AbortController().signal,stdin:toByteSource(''),stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}});
 assert.equal(result.exitCode,exitCode);assert.equal(stdout,'');assert.equal(stderr,'');assert.equal(retired,1);assert.deepEqual(await fs.readdir('/'),[]);
 const signal=new AbortController().signal,context={fs,cwd:'/',env:{},signal,maxBytes:1000};
 await assert.rejects(async()=>{
  if(kind.endsWith('-discovery'))await loaderProvider.discover({...context,kind:kind.startsWith('fragment')?'fragments':'templates'});
  else if(kind==='template')await loaderProvider.templates('native')!('value',signal,context);
  else for await(const item of await loaderProvider.fragments('native')!('value',context))assert.fail(String(item));
 },error=>error instanceof LlmPluginExit&&error.exitCode===exitCode);
 assert.equal(retired,2);assert.deepEqual(await fs.readdir('/'),[]);
});
