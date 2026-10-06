import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonSourcePackageEnvironment} from './source-environment.js';

for(const legacy of [false,true])for(const requirementFile of [false,true])test(`source preparation builds a copied tree and installs a durable wheel; legacy=${legacy}; requirementFile=${requirementFile}`,async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/work/source',{recursive:true});await fs.mkdir('/storage');await fs.mkdir('/elsewhere');
 await fs.writeFile('/work/source/input.txt',new TextEncoder().encode('original'));
 await fs.writeFile('/elsewhere/requirements.txt',new TextEncoder().encode('./source'));
 const context={fs,cwd:'/work',signal:new AbortController().signal,env:{TOKEN:'fixture'},stdout:{async write(){}},stderr:{async write(){}}};
 const calls:string[]=[];
 const environment=createPythonSourcePackageEnvironment({}, {directory:'/storage',python:{createExecutor:()=>({terminate(){},async run(start){
  assert.equal(start.invocation.env.TOKEN,'fixture');
  const send=(value:any)=>start.host!.request({version:1,operation:'call',capability:'python_build',value});
  const request=await send({op:'request'}) as any;calls.push(request.hook);
  assert.notEqual(request.source,'/work/source');
  assert.equal(new TextDecoder().decode(await fs.readFile(request.source+'/input.txt')),'original');
  let result:unknown;
  if(request.hook==='read_build_system')result=legacy?null:{requires:[],check:[],backend:'backend',backendPath:['.']};
  else if(request.hook==='get_requires_for_build_wheel')result=[];
  else{assert.equal(request.hook,legacy?'build_legacy_wheel':'build_wheel');result='fixture-1.0-py3-none-any.whl';await fs.writeFile(request.wheelDirectory+'/'+result,Uint8Array.of(42));}
  await send({op:'text',text:JSON.stringify(result)});await send({op:'done'});return 0;
 }})}});
 try{
  const receipt=await environment.prepare({...context,...requirementFile?{requirementFiles:['/elsewhere/requirements.txt']}:{requirements:['./source','./source']}});
  try{
   assert.deepEqual(calls,legacy?['read_build_system','build_legacy_wheel']:['read_build_system','get_requires_for_build_wheel','build_wheel']);
   assert.equal(receipt.requested?.length,1);
   const url=receipt.requested![0]!;assert.ok(url.startsWith('file:///storage/'));assert.ok(url.endsWith('/fixture-1.0-py3-none-any.whl'));
   assert.deepEqual(await fs.readFile(decodeURIComponent(new URL(url).pathname)),Uint8Array.of(42));
   assert.ok((await fs.readdir('/storage')).every(entry=>!entry.name.startsWith('.python-')));
  }finally{await environment.finish(receipt);}
 }finally{await environment.dispose();}
});

test('ordinary package requirements do not start a build or require command context',async()=>{
 const fs=new MemoryFileSystem();let runs=0;
 const environment=createPythonSourcePackageEnvironment({}, {directory:'/absent',python:{createExecutor:()=>{runs++;throw new Error('unexpected build');}}});
 try{
  const receipt=await environment.prepare({fs,cwd:'/',signal:new AbortController().signal,requirements:['fixture==1','https://example.test/fixture-1-py3-none-any.whl']});
  assert.deepEqual(receipt.requested,['fixture==1','https://example.test/fixture-1-py3-none-any.whl']);assert.equal(runs,0);
  await environment.finish(receipt);
 }finally{await environment.dispose();}
});
test('failed source backend preserves its exception and cleans only the owned build tree',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/source');await fs.mkdir('/storage');
 await fs.writeFile('/storage/keep',Uint8Array.of(5));
 const environment=createPythonSourcePackageEnvironment({}, {directory:'/storage',python:{createExecutor:()=>({terminate(){},async run(start){
  await start.host!.request({version:1,operation:'call',capability:'python_build',value:{op:'error',type:'ValueError',message:'invalid source'}});return 0;
 }})}});
 try{
  await assert.rejects(environment.prepare({fs,cwd:'/',signal:new AbortController().signal,requirements:['/source'],env:{},stdout:{async write(){}},stderr:{async write(){}}}),{name:'ValueError',message:'invalid source'});
  assert.deepEqual((await fs.readdir('/storage')).map(entry=>entry.name),['keep']);
  assert.deepEqual(await fs.readFile('/storage/keep'),Uint8Array.of(5));
 }finally{await environment.dispose();}
});

for(const late of [false,true])test(`a substituted build directory cannot redirect source copies outside build storage; late=${late}`,async()=>{
 const backing=new MemoryFileSystem();await backing.mkdir('/source');await backing.mkdir('/storage');await backing.mkdir('/outside');
 await backing.writeFile('/source/input',Uint8Array.of(9));let substituted=false,staging='';
 const swap=async()=>{substituted=true;await backing.rename(staging,'/owned');await backing.symlink('/outside',staging);};
 const fs=new Proxy(backing,{get(target,key){
  if(key==='prepareDirectory')return async(...args:Parameters<typeof target.prepareDirectory>)=>{
   const result=await target.prepareDirectory(...args);
   if(!substituted&&args[0].startsWith('/storage/.python-build-')){
    staging=args[0];if(!late)await swap();
   }
   return result;
  };
  if(key==='realpath')return async(...args:Parameters<typeof target.realpath>)=>{if(late&&!substituted&&staging&&args[0]==='/source')await swap();return target.realpath(...args);};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const environment=createPythonSourcePackageEnvironment({}, {directory:'/storage',python:{createExecutor:()=>({terminate(){},async run(){throw new Error('backend should not start');}})}});
 try{
  await assert.rejects(environment.prepare({fs,cwd:'/',signal:new AbortController().signal,requirements:['/source'],env:{},stdout:{async write(){}},stderr:{async write(){}}}));
  assert.deepEqual(await backing.readdir('/outside'),[]);
 }finally{await environment.dispose();}
});
