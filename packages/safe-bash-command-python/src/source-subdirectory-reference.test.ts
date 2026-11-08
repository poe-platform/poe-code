import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonSourcePackageEnvironment} from './source-environment.js';
const python=process.env.LLM_TEST_PYTHON??'python3';
const available=spawnSync(python,['-B','-c','import pip; assert pip.__version__ == "21.2.4"'],{timeout:5000}).status===0;
for(const fragment of ['subdirectory=src/pkg','subdirectory=src%2Fpkg','subdirectory=src+pkg','subdirectory=one&subdirectory=two','subdirectory=界','subdirectory=','other=first&subdirectory=second'])test('source URL subdirectory selection matches pinned pip: '+fragment,{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned pip==21.2.4':false},async()=>{
 const requirement='file:///source#'+fragment;
 const reference=spawnSync(python,['-B','-c',String.raw`
import json,sys
from pip._internal.req.constructors import install_req_from_line
request=install_req_from_line(sys.argv[1]);request.source_dir='/source'
print(json.dumps(request.unpacked_source_directory))
`,requirement],{encoding:'utf8',timeout:5000});
 assert.ifError(reference.error);assert.equal(reference.status,0,reference.stderr);
 const original=(JSON.parse(reference.stdout) as string).replaceAll('//','/');
 const fs=new MemoryFileSystem();await fs.mkdir(original,{recursive:true});await fs.mkdir('/builds');
 await fs.writeFile(original+'/proof',new TextEncoder().encode(fragment));let inspected=false;
 const environment=createPythonSourcePackageEnvironment({}, {directory:'/builds',python:{createExecutor:()=>({terminate(){},async run(start){
  const send=(value:any)=>start.host!.request({version:1,operation:'call',capability:'python_build',value});
  const request=await send({op:'request'}) as any;
  assert.equal(new TextDecoder().decode(await fs.readFile(request.source+'/proof')),fragment);let result:unknown;
  if(request.hook==='read_build_system'){inspected=true;result=null;}
  else if(request.hook==='get_requires_for_legacy_wheel')result=[];
  else{assert.equal(request.hook,'build_legacy_wheel');result='fixture-1-py3-none-any.whl';await fs.writeFile(request.wheelDirectory+'/'+result,Uint8Array.of(42));}
  await send({op:'text',text:JSON.stringify(result)});await send({op:'done'});return 0;
 }})}});
 try{
  const receipt=await environment.prepare({fs,cwd:'/',signal:new AbortController().signal,requirements:[requirement],env:{},stdout:{async write(){}},stderr:{async write(){}}});
  await environment.finish(receipt);assert.equal(inspected,true);
  assert.ok((await fs.readdir('/builds')).every(entry=>!entry.name.startsWith('.python-')));
 }finally{await environment.dispose();}
});

for(const link of ['../outside','linked'])test('source subdirectories cannot escape the owned source tree: '+link,async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/source');await fs.mkdir('/outside');await fs.mkdir('/builds');await fs.symlink('/outside','/source/linked');let runs=0;
 const environment=createPythonSourcePackageEnvironment({}, {directory:'/builds',python:{createExecutor:()=>{runs++;throw new Error('must not run backend');}}});
 try{
  await assert.rejects(environment.prepare({fs,cwd:'/',signal:new AbortController().signal,requirements:['file:///source#subdirectory='+link],env:{},stdout:{async write(){}},stderr:{async write(){}}}),/subdirectory escapes/);
  assert.equal(runs,0);assert.deepEqual(await fs.readdir('/builds'),[]);assert.deepEqual(await fs.readdir('/outside'),[]);
 }finally{await environment.dispose();}
});
