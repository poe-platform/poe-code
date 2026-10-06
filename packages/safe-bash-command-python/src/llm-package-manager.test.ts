import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {toByteSource, type CommandContext} from 'safe-bash-contracts';
import {createPythonPackageEnvironment} from './provisioning.js';
import {createPythonLlmPackageManager} from './llm-package-manager.js';

function context(): CommandContext {
  return {command:'llm',args:[],fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,
    stdin:toByteSource(''),stdout:{async write(){}},stderr:{async write(){}}} as CommandContext;
}

test('native LLM package planning retires before the authorized install starts',async()=>{
  const environment=createPythonPackageEnvironment();
  const events:string[]=[];
  const manage=createPythonLlmPackageManager({environment,maxConcurrentWorkers:1,createExecutor:()=>{
    let installing=false;
    return {async terminate(){events.push(installing?'installed-retired':'planner-retired');},async run(start){
      start.onReady();installing=!!start.installOnly;
      if(installing){
        assert.deepEqual(events,['planned','planner-retired']);
        assert.deepEqual(start.invocation.args,['-m','pip','install','fixture==1']);
        assert.deepEqual(start.packages?.requirements,['fixture==1']);
        events.push('installed');return 0;
      }
      assert.deepEqual(start.invocation.args.slice(2),['install','fixture==1']);
      await start.host!.request({version:1,operation:'call',capability:'llm_packages',value:['pip','install','fixture==1']});
      events.push('planned');return 0;
    }};
  }});
  try {
    assert.equal((await manage({context:context(),args:['install','fixture==1']})).exitCode,0);
    assert.deepEqual(events,['planned','planner-retired','installed','installed-retired']);
  } finally {await environment.dispose();}
});

test('native help and parse failures never start a package mutation',async()=>{
  for(const exitCode of [0,2]){
    const environment=createPythonPackageEnvironment();let runs=0,retired=0;
    const manage=createPythonLlmPackageManager({environment,createExecutor:()=>({async terminate(){retired++;},async run(start){
      runs++;start.onReady();assert.equal(start.installOnly,false);return exitCode;
    }})});
    try {
      assert.equal((await manage({context:context(),args:['install','--help']})).exitCode,exitCode);
      assert.equal(runs,1);assert.equal(retired,1);
    } finally {await environment.dispose();}
  }
});

test('failed planning never executes a previously captured package intent',async()=>{
  const environment=createPythonPackageEnvironment();let runs=0,retired=0;
  const manage=createPythonLlmPackageManager({environment,createExecutor:()=>({async terminate(){retired++;},async run(start){
    runs++;start.onReady();
    await start.host!.request({version:1,operation:'call',capability:'llm_packages',value:['pip','install','fixture==1']});
    return 2;
  }})});
  try {
    assert.equal((await manage({context:context(),args:['install','fixture==1']})).exitCode,2);
    assert.equal(runs,1);assert.equal(retired,1);
  } finally {await environment.dispose();}
});
