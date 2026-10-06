import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {toByteSource} from 'safe-bash-contracts';
import {createPythonExecutorCommands} from './executor.js';

for(const failed of [false,true])test(`package retirement settles before returning and releases confirmed interpreter capacity, failed=${failed}`,async()=>{
 let entered!:()=>void,release!:()=>void,first=true;
 const begun=new Promise<void>(resolve=>{entered=resolve;});
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const commands=createPythonExecutorCommands({maxConcurrentWorkers:1,environment:{
  async prepare(){return {session:'fixture',requirements:[],offline:false};},async dispatch(){return null;},
  async finish(){if(!first)return;first=false;entered();await gate;if(failed)throw new Error('package close failed');},async dispose(){},
 },createExecutor:()=>({async run(start){start.onReady();return 0;},terminate(){}})});
 const context=()=>({command:'python',args:['-c','pass'],fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,stdin:toByteSource(''),stdout:{async write(){}},stderr:{async write(){}}});
 const running=commands[0]!.execute(context());
 await begun;
 assert.equal((await commands[0]!.execute(context())).exitCode,1);
 release();
 assert.equal((await running).exitCode,failed?1:0);
 assert.equal((await commands[0]!.execute(context())).exitCode,0);
});
