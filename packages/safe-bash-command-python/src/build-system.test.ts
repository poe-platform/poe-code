import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonBuildBackend} from './build-backend.js';
import {createPythonBuildEnvironment} from './build-environment.js';

test('build-system inspection retains its input limit and returns typed configuration or legacy selection',async()=>{
 const environment=createPythonBuildEnvironment();let received:unknown;
 let result:unknown={requires:['tool==1'],backend:'fixture:builder',check:[],backendPath:['.']};
 const backend=createPythonBuildBackend({environment,createExecutor:()=>({terminate(){},async run(start){
  const send=(value:any)=>start.host!.request({version:1,operation:'call',capability:'python_build',value});
  received=await send({op:'request'});await send({op:'text',text:JSON.stringify(result)});await send({op:'done'});return 0;
 }})});
 const context={fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,maxBytes:1024,stdout:{async write(){}},stderr:{async write(){}}};
 try{
  const running=backend({hook:'read_build_system',source:'/source',name:'fixture'},context);context.maxBytes=Infinity;
  const value=await running;assert.deepEqual(value,result);
  assert.deepEqual(received,{hook:'read_build_system',source:'/source',name:'fixture',maxBytes:1024});
  if(value)assert.equal(value.backend,'fixture:builder');
  result=null;assert.equal(await backend({hook:'read_build_system',source:'/source'},context),null);
  for(result of [{requires:[1],backend:'backend',check:[],backendPath:[]},{requires:[],backend:12,check:[],backendPath:[]},{requires:[],backend:'backend',check:null,backendPath:[]}]){
   await assert.rejects(backend({hook:'read_build_system',source:'/source'},context),/build system/);
  }
 }finally{await environment.dispose();}
});
