import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem,FsError} from '@poe-code/safe-fs/core';
import {toByteSource} from 'safe-bash-contracts';
import {createPythonExecutorCommands} from './executor.js';

for(const late of [false,true])test('unsupported directory cursors preserve directory diagnostics: late='+late,async()=>{
 const fs=new MemoryFileSystem(),categories:string[]=[];
 fs.iterateDirectory=async function*(){if(late)yield {name:'entry',type:'file'};throw new FsError('ENOTSUP');};
 const command=createPythonExecutorCommands({onDiagnostic:event=>{categories.push(event.failure.category);},createExecutor:()=>({terminate(){},async run(start){
  await assert.rejects(async()=>{
   const id=await start.dispatch({op:'directoryOpen',args:['/']});
   await start.dispatch({op:'directoryNext',args:[id]});
   await start.dispatch({op:'directoryNext',args:[id]});
  },{code:'ENOTSUP'});return 0;
 }})})[0]!;
 const result=await command.execute({command:'python',args:['-c','pass'],cwd:'/',env:{},fs,signal:new AbortController().signal,stdin:toByteSource(''),stdout:{async write(){}},stderr:{async write(){}}});
 assert.equal(result.exitCode,0);assert.deepEqual(categories,['filesystem-directory']);
});
