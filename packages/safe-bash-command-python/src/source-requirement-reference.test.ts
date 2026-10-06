import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {createPythonBuildBackend} from './build-backend.js';
import {createPythonBuildEnvironment} from './build-environment.js';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
const python=process.env.LLM_TEST_PYTHON??'python3';
const available=spawnSync(python,['-B','-c','import pip; assert pip.__version__ == "21.2.4"'],{timeout:5000}).status===0;
test('named source requirements retain pinned pip names, extras, URLs and marker decisions',{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned pip==21.2.4':false},async()=>{
 let pythonBuildBackendProgram='';
 const environment=createPythonBuildEnvironment();
 try{
  await createPythonBuildBackend({environment,createExecutor:()=>({terminate(){},async run(start){
   pythonBuildBackendProgram=start.invocation.args[1]!;
   const send=(value:any)=>start.host!.request({version:1,operation:'call',capability:'python_build',value});
   await send({op:'text',text:'null'});await send({op:'done'});return 0;
  }})})({hook:'read_source_requirement',source:'fixture'}, {fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,maxBytes:4096,stdout:{async write(){}},stderr:{async write(){}}});
 }finally{await environment.dispose();}
 const result=spawnSync(python,['-B','-c',String.raw`
import json,sys,types
from pip._internal.req.constructors import install_req_from_line
from pip._vendor.packaging import requirements
sys.modules['micropip._vendored.packaging.src.packaging.requirements']=requirements
program=json.load(sys.stdin)
for value in ['fixture @ file:///work/source','Fixture_Name[Second,first,dotted.extra,dash-extra,repeated___extra] @ file:///work/source.zip','fixture @ file:///work/source ; python_version < "1"','fixture @ file:///work/source ; python_version >= "3"','fixture @ https://example.test/source.tar.gz','fixture==1','./path@name']:
 request=dict(hook='read_source_requirement',source=value)
 messages=[]
 def send(capability,message):
  if message['op']=='request': return request
  messages.append(message)
 sys.modules['safe_host']=types.SimpleNamespace(call=send)
 exec(program,{})
 assert messages[-1]==dict(op='done'),messages
 actual=json.loads(''.join(message['text'] for message in messages[:-1]))
 if value in ('fixture==1','./path@name'):expected=None
 else:
  reference=install_req_from_line(value)
  expected=dict(name=reference.req.name,extras=sorted(reference.extras),url=reference.link.url,marker=str(reference.markers) if reference.markers else None,active=reference.match_markers())
 assert actual==expected,(value,actual,expected)
`],{input:JSON.stringify(pythonBuildBackendProgram),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
