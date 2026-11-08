import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonBuildBackend} from './build-backend.js';
import {createPythonBuildEnvironment} from './build-environment.js';
const python=process.env.LLM_TEST_PYTHON??'python3';
const available=spawnSync(python,['-B','-c','import pip; assert pip.__version__ == "21.2.4"'],{timeout:5000}).status===0;
test('legacy setup requirements use genuine setuptools discovery and retain native failures',{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned pip==21.2.4':false},async()=>{
 let program='';const environment=createPythonBuildEnvironment();
 try{
  const hook=createPythonBuildBackend({environment,createExecutor:()=>({terminate(){},async run(start){
   assert.deepEqual(start.packages?.bootstrapPackages,['setuptools']);program=start.invocation.args[1]!;
   const send=(value:any)=>start.host!.request({version:1,operation:'call',capability:'python_build',value});
   await send({op:'text',text:'[]'});await send({op:'done'});return 0;
  }})});
  await hook({hook:'get_requires_for_legacy_wheel',source:'/source'} as any,{fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,maxBytes:4096,stdout:{async write(){}},stderr:{async write(){}}});
 }finally{await environment.dispose();}
 const result=spawnSync(python,['-B','-c',String.raw`
import contextlib,io,json,sys,types
from unittest.mock import patch
from setuptools import build_meta
program=json.load(sys.stdin)
for required in [['helper>=1'],['helper @ file:///work/helper-1-py3-none-any.whl'],['invalid @@@']]:
 source='from setuptools import setup\nsetup(name="fixture",version="1",setup_requires='+repr(required)+')\n'
 request=dict(hook='get_requires_for_legacy_wheel',source='/source')
 messages=[]
 def send(capability,message):
  if message['op']=='request':return request
  messages.append(message)
 sys.modules['safe_host']=types.SimpleNamespace(call=send)
 expected_output,actual_output=io.StringIO(),io.StringIO();failure=None
 with patch('os.chdir'),patch('setuptools.build_meta._open_setup_script',side_effect=lambda _:io.StringIO(source)),patch('setuptools.dist.Distribution.parse_config_files'):
  with contextlib.redirect_stdout(actual_output):exec(program,{})
  with contextlib.redirect_stdout(expected_output):
   try:expected=build_meta.__legacy__.get_requires_for_build_wheel()
   except BaseException as error:failure=error
 assert actual_output.getvalue()==expected_output.getvalue()
 if failure:assert messages==[dict(op='error',type=type(failure).__name__,message=str(failure))],messages
 else:
  assert messages[-1]==dict(op='done'),messages
  assert json.loads(''.join(message['text'] for message in messages[:-1]))==expected
`],{input:JSON.stringify(program),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
