import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonPackageEnvironment} from './provisioning.js';

test('nested local requirement files match native pip ordering and relative includes',async()=>{
 const files:Record<string,string>={
  '/project/requirements.txt':'alpha==1\n-r nested/one.txt\n--requirement=nested/two.txt\n-rnested/one.txt\n--requirem=nested/one.txt\n--requiremen nested/two.txt\n-r nested/two.txt -r nested/one.txt\nomega==2',
  '/project/nested/one.txt':'beta==3\n--requirement "more packages.txt"',
  '/project/nested/two.txt':'delta==5',
  '/project/nested/more packages.txt':'gamma==4',
 };
 const native=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',`import json,sys,os
from unittest.mock import patch
from pip._internal.req.req_file import RequirementsFileParser,get_line_parser
files=json.load(sys.stdin)
with patch('pip._internal.req.req_file.get_file_content',side_effect=lambda path,session:(path,files[os.path.normpath(path)])):
 print(json.dumps([line.requirement for line in RequirementsFileParser(None,get_line_parser(None)).parse('/project/requirements.txt',False)]))
`],{input:JSON.stringify(files),encoding:'utf8',timeout:5000});
 assert.ifError(native.error);assert.equal(native.status,0,native.stderr);
 const fs=new MemoryFileSystem();await fs.mkdir('/project/nested',{recursive:true});
 for(const [path,source] of Object.entries(files))await fs.writeFile(path,new TextEncoder().encode(source));
 const environment=createPythonPackageEnvironment();
 try{
  const prepared=await environment.prepare({fs,cwd:'/project',requirementFiles:['requirements.txt'],signal:new AbortController().signal});
  assert.deepEqual(prepared.requested,[...new Set(JSON.parse(native.stdout) as string[])]);
  await environment.finish(prepared);
 }finally{await environment.dispose();}
});

test('requirements reject active cycles including directory symlinks and permit later reuse',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/project',{recursive:true});
 await fs.symlink('/project','/project/link');
 await fs.writeFile('/project/requirements.txt',new TextEncoder().encode('-r link/requirements.txt'));
 const environment=createPythonPackageEnvironment();
 try{
  await assert.rejects(environment.prepare({fs,cwd:'/project',requirementFiles:['requirements.txt'],signal:new AbortController().signal}),/Recursive Python requirements/);
  await fs.writeFile('/project/requirements.txt',new TextEncoder().encode('alpha==1'));
  const prepared=await environment.prepare({fs,cwd:'/project',requirementFiles:['requirements.txt','requirements.txt'],signal:new AbortController().signal});
  assert.deepEqual(prepared.requested,['alpha==1']);await environment.finish(prepared);
 }finally{await environment.dispose();}
});

test('nested requirements share the caller byte allowance and retain cancellation',async()=>{
 const fs=new MemoryFileSystem();
 await fs.writeFile('/one',new TextEncoder().encode('-r two'));
 await fs.writeFile('/two',new TextEncoder().encode('alpha'));
 for(const maxRequirementBytes of [1,6,10,11]){
  const environment=createPythonPackageEnvironment({maxRequirementBytes});
  try{
   const prepare=()=>environment.prepare({fs,cwd:'/',requirementFiles:['one'],signal:new AbortController().signal});
   if(maxRequirementBytes<11)await assert.rejects(prepare);
   else{const prepared=await prepare();assert.deepEqual(prepared.requested,['alpha']);await environment.finish(prepared);}
  }finally{await environment.dispose();}
 }
 const controller=new AbortController(),reason=new Error('stop includes');
 const read=fs.readFile.bind(fs);fs.readFile=async(path,options)=>{const bytes=await read(path,options);if(path==='/one')controller.abort(reason);return bytes;};
 const environment=createPythonPackageEnvironment();
 try{await assert.rejects(environment.prepare({fs,cwd:'/',requirementFiles:['one'],signal:controller.signal}),error=>error===reason);}
 finally{await environment.dispose();}
});
