import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createLlmCommand} from 'safe-bash-command-llm';
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
