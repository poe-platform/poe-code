import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {toByteSource} from 'safe-bash-contracts';
import {createLlmCommand} from './command.js';

for(const action of ['install','uninstall'])test(`llm ${action} uses the explicit package capability and its output budget`,async()=>{
  let output='',error='';let calls=0;
  const command=createLlmCommand({limits:{maxOutputBytes:3},managePackages:async({context,args})=>{
    calls++;assert.deepEqual(args,[action,'--help']);
    await context.stdout.write(new TextEncoder().encode('ok\n'));
    await context.stdout.write(new TextEncoder().encode('overflow'));
    return {exitCode:0};
  }});
  const result=await command.execute({command:'llm',args:[action,'--help'],fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,stdin:toByteSource(''),stdout:{async write(bytes){output+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){error+=new TextDecoder().decode(bytes);}}});
  assert.equal(calls,1);assert.equal(result.exitCode,1);assert.equal(output,'ok\n');assert.match(error,/output byte limit/);
});
