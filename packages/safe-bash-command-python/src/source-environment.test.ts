import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonSourcePackageEnvironment} from './source-environment.js';
import {extractPythonSourceZip} from './source-zip.js';
import {makeZipEntry,writeZipArchive} from 'safe-bash-zip-engine';
import {DEFAULT_ARCHIVE_LIMITS} from 'safe-bash-io-engine/commands/archive/internal';

for(const zipped of [false,true])for(const legacy of [false,true])for(const requirementFile of [false,true])test(`source preparation builds a copied tree and installs a durable wheel; zip=${zipped}; legacy=${legacy}; requirementFile=${requirementFile}`,async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/work/source',{recursive:true});await fs.mkdir('/storage');await fs.mkdir('/elsewhere');
 await fs.writeFile('/work/source/input.txt',new TextEncoder().encode('original'));
 const requirement=zipped?'./source.zip':'./source';
 if(zipped){
  const signal=new AbortController().signal,entry=await makeZipEntry('project/input.txt',new TextEncoder().encode('original'),{modified:new Date(0),mode:0o644,directory:false,symlink:false},DEFAULT_ARCHIVE_LIMITS,signal);
  await fs.writeFile('/work/source.zip',await writeZipArchive({entries:[entry],comment:new Uint8Array()},DEFAULT_ARCHIVE_LIMITS,signal));
 }
 await fs.writeFile('/elsewhere/requirements.txt',new TextEncoder().encode(requirement));
 const context={fs,cwd:'/work',signal:new AbortController().signal,env:{TOKEN:'fixture'},stdout:{async write(){}},stderr:{async write(){}}};
 const calls:string[]=[];
 const environment=createPythonSourcePackageEnvironment({}, {directory:'/storage',extractArchive:extractPythonSourceZip,python:{createExecutor:()=>({terminate(){},async run(start){
  assert.equal(start.invocation.env.TOKEN,'fixture');
  const send=(value:any)=>start.host!.request({version:1,operation:'call',capability:'python_build',value});
  const request=await send({op:'request'}) as any;calls.push(request.hook);
  assert.notEqual(request.source,'/work/source');
  assert.equal(new TextDecoder().decode(await fs.readFile(request.source+'/input.txt')),'original');
  let result:unknown;
  if(request.hook==='read_build_system')result=legacy?null:{requires:[],check:[],backend:'backend',backendPath:['.']};
  else if((request.hook==='get_requires_for_build_wheel'||request.hook==='get_requires_for_legacy_wheel'))result=[];
  else{assert.equal(request.hook,legacy?'build_legacy_wheel':'build_wheel');result='fixture-1.0-py3-none-any.whl';await fs.writeFile(request.wheelDirectory+'/'+result,Uint8Array.of(42));}
  await send({op:'text',text:JSON.stringify(result)});await send({op:'done'});return 0;
 }})}});
 try{
  const receipt=await environment.prepare({...context,...requirementFile?{requirementFiles:['/elsewhere/requirements.txt']}:{requirements:[requirement,requirement]}});
  try{
   assert.deepEqual(calls,legacy?['read_build_system','get_requires_for_legacy_wheel','build_legacy_wheel']:['read_build_system','get_requires_for_build_wheel','build_wheel']);
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
  const receipt=await environment.prepare({fs,cwd:'/',signal:new AbortController().signal,requirements:['fixture==1','https://example.test/fixture-1-py3-none-any.whl','fixture @ https://example.test/fixture-1-py3-none-any.whl']});
  assert.deepEqual(receipt.requested,['fixture==1','https://example.test/fixture-1-py3-none-any.whl','fixture @ https://example.test/fixture-1-py3-none-any.whl']);assert.equal(runs,0);
  await environment.finish(receipt);
 }finally{await environment.dispose();}
});
test('failed source backend preserves its exception and cleans only the owned build tree',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/source');await fs.mkdir('/storage');
 await fs.writeFile('/storage/keep',Uint8Array.of(5));
 const environment=createPythonSourcePackageEnvironment({}, {directory:'/storage',extractArchive:extractPythonSourceZip,python:{createExecutor:()=>({terminate(){},async run(start){
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
 const environment=createPythonSourcePackageEnvironment({}, {directory:'/storage',extractArchive:extractPythonSourceZip,python:{createExecutor:()=>({terminate(){},async run(){throw new Error('backend should not start');}})}});
 try{
  await assert.rejects(environment.prepare({fs,cwd:'/',signal:new AbortController().signal,requirements:['/source'],env:{},stdout:{async write(){}},stderr:{async write(){}}}));
  assert.deepEqual(await backing.readdir('/outside'),[]);
 }finally{await environment.dispose();}
});

test('invalid source ZIP never invokes build hooks and removes its owned extraction tree',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/storage');await fs.writeFile('/broken.zip',Uint8Array.of(1,2,3));
 let runs=0;
 const environment=createPythonSourcePackageEnvironment({}, {directory:'/storage',extractArchive:extractPythonSourceZip,python:{createExecutor:()=>{runs++;throw new Error('unexpected build');}}});
 try{
  await assert.rejects(environment.prepare({fs,cwd:'/',signal:new AbortController().signal,requirements:['/broken.zip'],env:{},stdout:{async write(){}},stderr:{async write(){}}}));
  assert.equal(runs,0);assert.deepEqual(await fs.readdir('/storage'),[]);
 }finally{await environment.dispose();}
});

test('source archive selection requires an explicit host capability',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/storage');await fs.writeFile('/source.zip',Uint8Array.of(1));
 const environment=createPythonSourcePackageEnvironment({}, {directory:'/storage',python:{createExecutor:()=>{throw new Error('unexpected build');}}});
 try{
  await assert.rejects(environment.prepare({fs,cwd:'/',signal:new AbortController().signal,requirements:['/source.zip'],env:{},stdout:{async write(){}},stderr:{async write(){}}}),/extraction capability/);
  assert.deepEqual(await fs.readdir('/storage'),[]);
 }finally{await environment.dispose();}
});

test('local tar sources reach the configured archive capability before native build hooks',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/storage');await fs.writeFile('/source.tar',Uint8Array.of(1));
 const extracted=new Error('tar extraction reached');let calls=0;
 const environment=createPythonSourcePackageEnvironment({}, {directory:'/storage',async extractArchive(source,directory,_maxBytes,context){
  calls++;assert.equal(source,'/source.tar');assert.ok(directory.startsWith('/storage/.python-build-'));assert.equal(context.fs.capabilities.atomicTreeRemoval,true);throw extracted;
 },python:{createExecutor:()=>{throw new Error('unexpected build');}}});
 try{
  await assert.rejects(environment.prepare({fs,cwd:'/',signal:new AbortController().signal,requirements:['/source.tar'],env:{},stdout:{async write(){}},stderr:{async write(){}}}),error=>error===extracted);
  assert.equal(calls,1);assert.deepEqual(await fs.readdir('/storage'),[]);
 }finally{await environment.dispose();}
});

for(const active of [false,true])test(`named local sources retain name, extras and markers through wheel publication; active=${active}`,async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/source');await fs.mkdir('/storage');
 const requirement='Fixture[feature] @ file:///source ; python_version '+(active?'>= "3"':'< "1"');
 const calls:string[]=[];
 const environment=createPythonSourcePackageEnvironment({}, {directory:'/storage',python:{createExecutor:()=>({terminate(){},async run(start){
  const send=(value:any)=>start.host!.request({version:1,operation:'call',capability:'python_build',value});
  const request=await send({op:'request'}) as any;calls.push(request.hook);let value:unknown;
  if(request.hook==='read_source_requirement')value={name:'Fixture',extras:['feature'],url:'file:///source',marker:'python_version '+(active?'>= "3"':'< "1"'),active};
  else if(request.hook==='read_build_system')value=null;
  else if(request.hook==='get_requires_for_legacy_wheel')value=[];
  else{assert.equal(request.hook,'build_legacy_wheel');value='fixture-1-py3-none-any.whl';await fs.writeFile(request.wheelDirectory+'/'+value,Uint8Array.of(42));}
  await send({op:'text',text:JSON.stringify(value)});await send({op:'done'});return 0;
 }})}});
 try{
  const receipt=await environment.prepare({fs,cwd:'/',signal:new AbortController().signal,requirements:[requirement],env:{},stdout:{async write(){}},stderr:{async write(){}}});
  try{
   assert.deepEqual(calls,active?['read_source_requirement','read_build_system','get_requires_for_legacy_wheel','build_legacy_wheel']:['read_source_requirement']);
   if(active){assert.ok(receipt.requested![0]!.startsWith('Fixture[feature] @ file:///storage/'));assert.ok(receipt.requested![0]!.endsWith('/fixture-1-py3-none-any.whl ; python_version >= "3"'));}
   else{assert.deepEqual(receipt.requested,[requirement]);assert.deepEqual(await fs.readdir('/storage'),[]);}
  }finally{await environment.finish(receipt);}
 }finally{await environment.dispose();}
});
