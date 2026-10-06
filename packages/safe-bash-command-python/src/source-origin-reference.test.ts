import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {createPythonBuildBackend} from './build-backend.js';
import {createPythonBuildEnvironment} from './build-environment.js';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
const python=process.env.LLM_TEST_PYTHON??'python3';
const available=spawnSync(python,['-B','-c','import pip; assert pip.__version__ == "21.2.4"'],{timeout:5000}).status===0;
test('source provenance matches pinned pip PEP 610 URLs, hashes, subdirectories and authentication redaction',{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned pip==21.2.4':false},async()=>{
 let pythonBuildBackendProgram='';
 const environment=createPythonBuildEnvironment();
 try{
  await createPythonBuildBackend({environment,createExecutor:()=>({terminate(){},async run(start){
   pythonBuildBackendProgram=start.invocation.args[1]!;
   const send=(value:any)=>start.host!.request({version:1,operation:'call',capability:'python_build',value});
   await send({op:'text',text:'"download"'});await send({op:'done'});return 0;
  }})})({hook:'read_source_origin',source:'/source',directory:true},{fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,maxBytes:4096,stdout:{async write(){}},stderr:{async write(){}}});
 }finally{await environment.dispose();}
 const result=spawnSync(python,['-B','-c',String.raw`
import json,sys,types
from unittest.mock import patch
from pip._internal.models.link import Link
from pip._internal.utils.urls import path_to_url
from pip._internal.utils.direct_url_helpers import direct_url_from_link
program=json.load(sys.stdin)
for directory in [False,True]:
 for source in ["/work/a'(!)* 界",'file:///source/project','file:///source/project.zip','file:///source/a%20b.zip#subdirectory=nested%20path','https://example.test/source.zip#sha256=abc123','https://example.test/source.zip#md5=abc&sha256=def','https://example.test/source.zip?sha1=abc#subdirectory=first&subdirectory=second','https://example.test/source.zip#sha256=ABC','https://example.test/source.zip#sha256=abcZZ','https://user:synthetic@example.test/source.zip#subdirectory=','https://'+'$'+'{USER}:'+'$'+'{TOKEN}@example.test/source.zip','https://user:'+'$'+'{TOKEN}@example.test/source.zip']:
  with patch.object(Link,'is_existing_dir',return_value=directory):expected=direct_url_from_link(Link(path_to_url(source) if source.startswith('/') else source)).to_json()
  request=dict(hook='read_source_origin',source=source,directory=directory);messages=[]
  def send(capability,message):
   if message['op']=='request':return request
   messages.append(message)
  sys.modules['safe_host']=types.SimpleNamespace(call=send)
  exec(program,{})
  assert messages and messages[-1]==dict(op='done'),(request,messages)
  actual=json.loads(''.join(message['text'] for message in messages[:-1]))
  assert actual==expected,(request,actual,expected)
`],{input:JSON.stringify(pythonBuildBackendProgram),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
