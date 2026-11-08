import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonSourcePackageEnvironment} from './source-environment.js';
import {createPythonPackageEnvironment} from './provisioning.js';
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
  if(request.hook==='read_source_origin'){
   assert.equal(request.source,'/work/source'+(zipped?'.zip':''));assert.equal(request.directory,!zipped);
   await send({op:'text',text:JSON.stringify(JSON.stringify({url:'file:///work/source'+(zipped?'.zip':''),[zipped?'archive_info':'dir_info']:{}}))});await send({op:'done'});return 0;
  }
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
   assert.deepEqual(calls,legacy?['read_build_system','get_requires_for_legacy_wheel','build_legacy_wheel']:['read_build_system','get_requires_for_build_wheel','build_wheel','read_source_origin']);
   assert.equal(receipt.requested?.length,1);
   const url=receipt.requested![0]!;assert.ok(url.startsWith('file:///storage/'));assert.ok(new URL(url).pathname.endsWith('/fixture-1.0-py3-none-any.whl'));
   assert.deepEqual(await fs.readFile(decodeURIComponent(new URL(url).pathname)),Uint8Array.of(42));
   const opened=await environment.dispatch('package-open',[receipt.session,url],context) as {key:string};
   await environment.dispatch('package-close',[receipt.session,'not-open-artifact'],context);
   const retained=await environment.dispatch('package-retain',[receipt.session,opened.key],context) as {metadata?:Record<string,string>};
   assert.deepEqual(retained.metadata,legacy?{}:{'direct_url.json':JSON.stringify({url:'file:///work/source'+(zipped?'.zip':''),[zipped?'archive_info':'dir_info']:{}})});
   if(!legacy){
    const restored=createPythonSourcePackageEnvironment({}, {directory:'/storage',python:{createExecutor:()=>{throw new Error('must not rebuild');}}});
    const replay=await restored.prepare({...context,requirements:[url]});
    try{
     const reopened=await restored.dispatch('package-open',[replay.session,url],context) as {key:string};
     assert.deepEqual((await restored.dispatch('package-retain',[replay.session,reopened.key],context) as {metadata:unknown}).metadata,retained.metadata);
    }finally{await restored.finish(replay);await restored.dispose();}
   }
   const ordinary=new URL(url);ordinary.hash='';
   const unrelated=await environment.dispatch('package-open',[receipt.session,ordinary.href],context) as {key:string};
   assert.equal((await environment.dispatch('package-retain',[receipt.session,unrelated.key],context) as {metadata?:unknown}).metadata,undefined);
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

for(const filename of ['fixture-1-py3-none-any%2Ewhl','fixture-1-py3-none-any.%77%68%6c','bad%ff-1-py3-none-any%2ewhl'])test('percent-encoded wheel links remain package requirements: '+filename,async()=>{
 const environment=createPythonSourcePackageEnvironment({}, {directory:'/absent',python:{createExecutor:()=>{throw new Error('unexpected source build');}}});
 const requirements=['https://example.test/'+filename,'fixture @ https://example.test/'+filename];
 try{
  const receipt=await environment.prepare({fs:new MemoryFileSystem(),cwd:'/',signal:new AbortController().signal,requirements});
  assert.deepEqual(receipt.requested,requirements);await environment.finish(receipt);
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
   if(active){assert.ok(receipt.requested![0]!.startsWith('Fixture[feature] @ file:///storage/'));assert.ok(receipt.requested![0]!.endsWith('/fixture-1-py3-none-any.whl#python-source=null ; python_version >= "3"'));}
   else{assert.deepEqual(receipt.requested,[requirement]);assert.deepEqual(await fs.readdir('/storage'),[]);}
  }finally{await environment.finish(receipt);}
 }finally{await environment.dispose();}
});

for(const extras of ['', '[FEATURE,repeated___extra]'])for(const mode of ['input','defaults','file'])test(`editable preparation builds from live caller source without leaking editable roots to private tooling; mode=${mode}; extras=${extras}`,async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/work/source',{recursive:true});await fs.mkdir('/storage');
 await fs.writeFile('/work/source/input.txt',new TextEncoder().encode('live'));
 const line='--editable "./source'+extras+'"';
 await fs.writeFile('/requirements.txt',new TextEncoder().encode(line+' # editable source\n'));
 const calls:string[]=[];
 const environment=createPythonSourcePackageEnvironment(mode==='defaults'?{editable:['./source'+extras]}:{}, {directory:'/storage',python:{createExecutor:()=>({terminate(){},async run(start){
  const send=(value:any)=>start.host!.request({version:1,operation:'call',capability:'python_build',value});
  const request=await send({op:'request'}) as any;calls.push(request.hook);
  let result:unknown=null;
  if(request.hook==='read_editable_requirement'){
   assert.equal(request.source,mode==='file'?line:'./source'+extras);
   assert.equal(request.requirementLine,mode==='file'?true:undefined);
   result={name:'',url:'file:///work/source',extras:extras?['feature','repeated___extra']:[],marker:null,active:true};
  }else assert.equal(request.source,'/work/source');
  if(request.hook==='get_requires_for_legacy_wheel')result=[];
  if(request.hook==='build_legacy_wheel'){
   assert.equal(request.editable,true);
   result='fixture-1.0-py3-none-any.whl';await fs.writeFile(request.wheelDirectory+'/'+result,Uint8Array.of(42));
  }
  await send({op:'text',text:JSON.stringify(result)});await send({op:'done'});return 0;
 }})}});
 try{
  const receipt=await environment.prepare({fs,cwd:'/work',signal:new AbortController().signal,...mode==='file'?{requirementFiles:['/requirements.txt']}:mode==='defaults'?{}:{editable:['./source'+extras]},env:{},stdout:{async write(){}},stderr:{async write(){}}});
  try{
   assert.equal(receipt.requested?.length,1);
   assert.deepEqual(calls,[...extras||mode==='file'?['read_editable_requirement']:[],'read_build_system','get_requires_for_legacy_wheel','build_legacy_wheel']);
   if(extras)assert.ok(receipt.requested![0]!.startsWith('fixture[feature,repeated___extra] @ file:///storage/'));
   assert.equal(new TextDecoder().decode(await fs.readFile('/work/source/input.txt')),'live');
   assert.ok((await fs.readdir('/storage')).every(entry=>!entry.name.startsWith('.python-')));
  }finally{await environment.finish(receipt);}
 }finally{await environment.dispose();}
});

test('ordinary package environments refuse editable inputs without a source capability',async()=>{
 const environment=createPythonPackageEnvironment();
 try{await assert.rejects(environment.prepare({fs:new MemoryFileSystem(),cwd:'/',signal:new AbortController().signal,editable:['/source']}),/source package environment/);}
 finally{await environment.dispose();}
});
for(const source of ['/missing','https://example.test/source.zip','git+https://example.test/repo','file://elsewhere/source'])test('editable source admission cannot silently become an ordinary requirement: '+source,async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/storage');
 const environment=createPythonSourcePackageEnvironment({}, {directory:'/storage',python:{createExecutor:()=>{throw new Error('unexpected build');}}});
 try{
  await assert.rejects(environment.prepare({fs,cwd:'/',signal:new AbortController().signal,editable:[source],env:{},stdout:{async write(){}},stderr:{async write(){}}}),/Editable source requires/);
  assert.deepEqual(await fs.readdir('/storage'),[]);
 }finally{await environment.dispose();}
});

test('requirements comments retain URL integrity fragments and ignore only whitespace-delimited hashes',async()=>{
 const fs=new MemoryFileSystem();
 await fs.writeFile('/requirements.txt',new TextEncoder().encode('# ignored\nfixture @ https://example.test/fixture.whl#sha256=abc # ignored\na==1#fragment\nb==2\t# ignored\nc==3\u00a0# ignored\n'));
 const environment=createPythonPackageEnvironment();
 try{
  const receipt=await environment.prepare({fs,cwd:'/',signal:new AbortController().signal,requirementFiles:['/requirements.txt']});
  try{assert.deepEqual(receipt.requested,['fixture @ https://example.test/fixture.whl#sha256=abc','a==1#fragment','b==2','c==3']);}
  finally{await environment.finish(receipt);}
 }finally{await environment.dispose();}
});


test('source origin metadata is bounded independently from wheel bytes',async()=>{
 const fs=new MemoryFileSystem(),key=createHash('sha256').update(Uint8Array.of(42)).digest('hex');await fs.mkdir('/work/'+key,{recursive:true});await fs.writeFile('/work/'+key+'/fixture-1-py3-none-any.whl',Uint8Array.of(42));
 const environment=createPythonSourcePackageEnvironment({maxMetadataBytes:4},{directory:'/work',python:{createExecutor:()=>{throw new Error('must not build');}}});
 const url='file:///work/'+key+'/fixture-1-py3-none-any.whl#python-source='+encodeURIComponent('{"url":"file:///original"}');
 const context={fs,cwd:'/work',signal:new AbortController().signal,requirements:[url]};
 try{
  const start=await environment.prepare(context);
  try{await assert.rejects(environment.dispatch('package-open',[start.session,url],context),/source origin exceeds maxMetadataBytes/);}
  finally{await environment.finish(start);}
 }finally{await environment.dispose();}
});


test('source provenance markers do not reinterpret ordinary caller wheel fragments',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/work');await fs.writeFile('/work/fixture-1-py3-none-any.whl',Uint8Array.of(42));
 const environment=createPythonSourcePackageEnvironment({maxMetadataBytes:4},{directory:'/absent',python:{createExecutor:()=>{throw new Error('must not build');}}});
 const url='file:///work/fixture-1-py3-none-any.whl#python-source=not-json';
 const context={fs,cwd:'/work',signal:new AbortController().signal,requirements:[url]};
 try{
  const start=await environment.prepare(context);
  try{
   const opened=await environment.dispatch('package-open',[start.session,url],context) as {key:string};
   assert.equal((await environment.dispatch('package-retain',[start.session,opened.key],context) as {metadata?:unknown}).metadata,undefined);
  }finally{await environment.finish(start);}
 }finally{await environment.dispose();}
});

for(const algorithm of ['sha1','sha224','sha256','sha384','sha512','md5'])for(const valid of [false,true])test(`local source URL ${algorithm} integrity precedes extraction and uses owned bytes; valid=${valid}`,async()=>{
 const fs=new MemoryFileSystem(),signal=new AbortController().signal;
 await fs.mkdir('/work');await fs.mkdir('/storage');
 const payload=new TextEncoder().encode('original');
 const entry=await makeZipEntry('project/input.txt',payload,{modified:new Date(0),mode:0o644,directory:false,symlink:false},DEFAULT_ARCHIVE_LIMITS,signal);
 const archive=await writeZipArchive({entries:[entry],comment:new Uint8Array()},DEFAULT_ARCHIVE_LIMITS,signal);
 await fs.writeFile('/work/source.zip',archive);
 const hash=valid?createHash(algorithm).update(archive).digest('hex'):'0';
 let extracted=false;
 const done=new Error('verified extraction completed');
 const environment=createPythonSourcePackageEnvironment({}, {directory:'/storage',async extractArchive(source,directory,maxBytes,context,metadata){
  extracted=true;
  assert.notEqual(source,'/work/source.zip');
  await fs.writeFile('/work/source.zip',Uint8Array.of(0));
  await extractPythonSourceZip(source,directory,maxBytes,context,metadata);
  assert.deepEqual(await fs.readFile(directory+'/input.txt'),payload);
  throw done;
 },python:{createExecutor:()=>{throw new Error('unexpected build');}}});
 try{
  await assert.rejects(environment.prepare({fs,cwd:'/work',signal,requirements:['file:///work/source.zip#'+algorithm+'='+hash],env:{},stdout:{async write(){}},stderr:{async write(){}}}),error=>valid?error===done:error instanceof Error&&error.message.includes('integrity mismatch'));
  assert.equal(extracted,valid);assert.deepEqual(await fs.readdir('/storage'),[]);
 }finally{await environment.dispose();}
});


test('pinned pip checks every local source URL hash before unpacking',{skip:!process.env.LLM_TEST_PYTHON?'Requires pinned pip==21.2.4':false},async()=>{
 const signal=new AbortController().signal;
 const entry=await makeZipEntry('project/setup.py',new TextEncoder().encode('from setuptools import setup\nsetup(name="fixture",version="1")\n'),{modified:new Date(0),mode:0o644,directory:false,symlink:false},DEFAULT_ARCHIVE_LIMITS,signal);
 const archive=await writeZipArchive({entries:[entry],comment:new Uint8Array()},DEFAULT_ARCHIVE_LIMITS,signal);
 const reference=spawnSync(process.env.LLM_TEST_PYTHON!,['-B','-c',String.raw`
import base64,hashlib,io,json,sys,pip,mimetypes
from unittest.mock import patch
from pip._internal.req.constructors import install_req_from_line
from pip._internal.operations.prepare import get_file_url
from pip._internal.exceptions import HashMismatch
assert pip.__version__ == "21.2.4"
mimetypes.init(files=[])
archive=base64.b64decode(sys.stdin.read()); results=[]
for algorithm in ['sha1','sha224','sha256','sha384','sha512','md5']:
 for valid in [False,True]:
  digest=hashlib.new(algorithm,archive).hexdigest() if valid else '0'
  requirement=install_req_from_line('file:///work/source.zip#'+algorithm+'='+digest)
  with patch('builtins.open',return_value=io.BytesIO(archive)):
   try:
    get_file_url(requirement.link,hashes=requirement.hashes(False)); accepted=True
   except HashMismatch: accepted=False
  results.append([algorithm,valid,accepted])
print(json.dumps(results))
`],{input:Buffer.from(archive).toString('base64'),encoding:'utf8',timeout:5000});
 assert.ifError(reference.error);assert.equal(reference.status,0,reference.stderr);
 assert.deepEqual(JSON.parse(reference.stdout),['sha1','sha224','sha256','sha384','sha512','md5'].flatMap(algorithm=>[false,true].map(valid=>[algorithm,valid,valid])));
});

for(const mode of ['limit','cancel','change','short-write'])test('local source snapshot retires handles and staging on '+mode,async()=>{
 const backing=new MemoryFileSystem(),controller=new AbortController();
 await backing.mkdir('/storage');await backing.writeFile('/source.zip',new Uint8Array(196615).fill(37));
 let opened=0,closed=0,extracted=false;
 const cancelled=new Error('cancel local snapshot');
 const fs=new Proxy(backing,{get(target,key){
  if(key==='openReadFile')return async(...args:Parameters<typeof target.openReadFile>)=>{
   const file=await target.openReadFile(...args);opened++;let reads=0;
   return {stat:file.stat.bind(file),async read(offset:number,length:number,options?:Parameters<typeof file.read>[2]){
    assert.ok(length<=65536);reads++;
    const bytes=await file.read(offset,Math.min(length,16384),options);
    if(reads===14){if(mode==='cancel')controller.abort(cancelled);if(mode==='change')await backing.writeFile('/source.zip',Uint8Array.of(1));}
    return bytes;
   },async close(){closed++;await file.close();}};
  };
  if(key==='confineExtraction')return async(...args:Parameters<typeof target.confineExtraction>)=>{
   const confined=await target.confineExtraction(...args);
   return new Proxy(confined,{get(output,property){
    if(property==='writeStream'&&mode==='short-write')return async()=>{};
    const value=Reflect.get(output,property);return typeof value==='function'?value.bind(output):value;
   }});
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const environment=createPythonSourcePackageEnvironment({maxDownloadBytes:mode==='limit'?100:1000000},{directory:'/storage',async extractArchive(){extracted=true;},python:{createExecutor:()=>{throw new Error('unexpected build');}}});
 try{
  await assert.rejects(environment.prepare({fs,cwd:'/',signal:controller.signal,requirements:['file:///source.zip#md5=0'],env:{},stdout:{async write(){}},stderr:{async write(){}}}),error=>mode==='cancel'?error===cancelled:error instanceof Error&&error.message.includes(mode==='limit'?'maxDownloadBytes':mode==='change'?'changed':'write ended early'));
  assert.equal(extracted,false);assert.equal(opened,1);assert.equal(closed,1);assert.deepEqual(await backing.readdir('/storage'),[]);
 }finally{await environment.dispose();}
});
