import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonBuildDependencies} from './build-dependencies.js';
import {createPythonBuildEnvironment} from './build-environment.js';

const context=()=>({fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,maxBytes:4096,stdout:{async write(){}},stderr:{async write(){}}});
const request={source:'/source',name:'fixture',buildSystem:{requires:['declared==1'],backend:'fixture:backend',backendPath:['.'],check:[]},configSettings:{feature:['one','two']}};

test('build preparation installs declared then missing dynamic dependencies and preserves explicit build state',async()=>{
 const environment=createPythonBuildEnvironment();const calls:unknown[]=[];
 const prepare=createPythonBuildDependencies({environment,createExecutor:()=>({terminate(){},async run(start){
  if(start.installOnly){
   calls.push(start.packages?.requested);
   if(start.packages?.requested?.includes('declared==1'))await start.dispatch({op:'package-commit',args:[start.packages.session,{version:2,installed:['declared==1'],records:[['declared','Metadata-Version: 2.1\nName: declared\nVersion: 1\n','',[],[]]]}]});
   return 0;
  }
  const send=(value:any)=>start.host!.request({version:1,operation:'call',capability:'python_build',value});
  const value=await send({op:'request'}) as any;calls.push(value);
  const result=value.hook==='get_requires_for_build_wheel'?['extra==1']: {conflicting:[],missing:['extra==1']};
  await send({op:'text',text:JSON.stringify(result)});await send({op:'done'});return 0;
 }})});
 try{
  await prepare(request,context());
  assert.deepEqual(calls,[['declared==1'],{hook:'get_requires_for_build_wheel',source:'/source',backend:'fixture:backend',backendPath:['.'],configSettings:{feature:['one','two']}},{hook:'check_build_requirements',source:'/source',requirements:['extra==1'],installed:['declared']},['extra==1']]);
  const receipt=await environment.prepare(context());await environment.finish(receipt);
 }finally{await environment.dispose();}
});

test('backend conflicts stop before dynamic installation and retain pinned diagnostics',async()=>{
 const environment=createPythonBuildEnvironment();let installations=0;
 const prepare=createPythonBuildDependencies({environment,createExecutor:()=>({terminate(){},async run(start){
  if(start.installOnly){installations++;return 0;}
  const send=(value:any)=>start.host!.request({version:1,operation:'call',capability:'python_build',value});
  const request=await send({op:'request'}) as any;
  await send({op:'text',text:JSON.stringify(request.hook==='get_requires_for_build_wheel'?['declared>=2']:{conflicting:[['declared==1','declared>=2']],missing:[]})});await send({op:'done'});return 0;
 }})});
 try{await assert.rejects(prepare(request,context()),{name:'InstallationError',message:'Some build dependencies for fixture conflict with the backend dependencies: declared==1 is incompatible with declared>=2.'});assert.equal(installations,1);}finally{await environment.dispose();}
});

test('invalid configuration refuses before installing any build dependency',async()=>{
 const environment=createPythonBuildEnvironment();let runs=0;
 const prepare=createPythonBuildDependencies({environment,createExecutor:()=>({terminate(){},async run(){runs++;return 0;}})});
 try{await assert.rejects(prepare({...request,configSettings:{invalid:1} as any},context()),TypeError);assert.equal(runs,0);}finally{await environment.dispose();}
});

test('failed declared installation never invokes backend hooks',async()=>{
 const environment=createPythonBuildEnvironment();let runs=0;
 const prepare=createPythonBuildDependencies({environment,createExecutor:()=>({terminate(){},async run(start){runs++;assert.equal(start.installOnly,true);return 7;}})});
 try{await assert.rejects(prepare(request,context()),/installation exited with status 7/);assert.equal(runs,1);}finally{await environment.dispose();}
});

test('missing fallback requirements warn before backend invocation without installing defaults',async()=>{
 const environment=createPythonBuildEnvironment();const calls:string[]=[];let diagnostic='';
 const prepare=createPythonBuildDependencies({environment,createExecutor:()=>({terminate(){},async run(start){
  assert.equal(start.installOnly,false);
  const send=(value:any)=>start.host!.request({version:1,operation:'call',capability:'python_build',value});
  const request=await send({op:'request'}) as any;calls.push(request.hook);
  if(request.hook==='get_requires_for_build_wheel')assert.ok(diagnostic.includes("without 'wheel'"));
  await send({op:'text',text:JSON.stringify(request.hook==='check_build_requirements'?{conflicting:[],missing:['wheel']}:[])});await send({op:'done'});return 0;
 }})});
 try{
  await prepare({...request,buildSystem:{...request.buildSystem,requires:[],check:['wheel']}},{...context(),stderr:{async write(bytes){diagnostic+=new TextDecoder().decode(bytes);}}});
  assert.deepEqual(calls,['check_build_requirements','get_requires_for_build_wheel']);
  assert.equal(diagnostic,"Missing build requirements in pyproject.toml for fixture.\nThe project does not specify a build backend, and pip cannot fall back to setuptools without 'wheel'.\n");
 }finally{await environment.dispose();}
});
