import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {createPythonBuildBackend} from './build-backend.js';
import {createPythonBuildEnvironment} from './build-environment.js';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
const python=process.env.LLM_TEST_PYTHON??'python3';
const available=spawnSync(python,['-B','-c','import pip; assert pip.__version__ == "21.2.4"'],{timeout:5000}).status===0;
test('editable source extras and file URLs retain pinned pip parsing without named-requirement normalization',{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned pip==21.2.4':false},async()=>{
 let pythonBuildBackendProgram='';
 const environment=createPythonBuildEnvironment();
 try{
  await createPythonBuildBackend({environment,createExecutor:()=>({terminate(){},async run(start){
   pythonBuildBackendProgram=start.invocation.args[1]!;
   const send=(value:any)=>start.host!.request({version:1,operation:'call',capability:'python_build',value});
   await send({op:'text',text:'null'});await send({op:'done'});return 0;
  }})})({hook:'read_editable_requirement',source:'/project[FEATURE]'}, {fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,maxBytes:4096,stdout:{async write(){}},stderr:{async write(){}}});
 }finally{await environment.dispose();}
 const result=spawnSync(python,['-B','-c',String.raw`
import json,sys,types,os,io,contextlib
from unittest.mock import patch
from pip._internal.req.constructors import parse_editable
from pip._vendor.packaging import requirements
sys.modules['micropip._vendored.packaging.src.packaging.requirements']=requirements
program=json.load(sys.stdin)
for value in ['/project[]','/project[foo][FEATURE]','/project # 界[FEATURE]','/project[FEATURE]','/project[dotted.extra,dash-extra,repeated___extra]','/project[one,two]','file:///project[FEATURE]','file:///project#egg=Fixture[FEATURE]','file:///project#subdirectory=inside&egg=Fixture[FEATURE]']:
 request=dict(hook='read_editable_requirement',source=value)
 messages=[]
 def send(capability,message):
  if message['op']=='request': return request
  messages.append(message)
 sys.modules['safe_host']=types.SimpleNamespace(call=send)
 with patch('os.path.isdir',side_effect=lambda path:path in ('/project','/project[]','/project[foo]','/project # 界')),patch('os.path.exists',return_value=True):
  name,url,extras=parse_editable(value)
  exec(program,{})
 assert messages[-1]==dict(op='done'),messages
 actual=json.loads(''.join(message['text'] for message in messages[:-1]))
 assert actual==dict(name=name or '',url=url,extras=sorted(extras),marker=None,active=True),(value,actual,(name,url,extras))
from pip._internal.req.req_file import get_line_parser
for line in ['-e /project[FEATURE]','--editable=/project[FEATURE]','-e/project[FEATURE]','--editable "/project[FEATURE]"','-e /project[FEATURE] ignored','-e /project[FEATURE] -e /unused']:
 request=dict(hook='read_editable_requirement',source=line,requirementLine=True)
 messages=[]
 with patch('os.path.isdir',side_effect=lambda path:path=='/project'),patch('os.path.exists',return_value=True):
  args,options=get_line_parser(None)(line)
  assert args==''
  name,url,extras=parse_editable(options.editables[0])
  exec(program,{})
 assert messages[-1]==dict(op='done'),messages
 actual=json.loads(''.join(message['text'] for message in messages[:-1]))
 assert actual==dict(name=name or '',url=url,extras=sorted(extras),marker=None,active=True),(line,actual)
for line in ['-e','--editable','--unknown','--editable "unterminated']:
 request=dict(hook='read_editable_requirement',source=line,requirementLine=True)
 messages=[]
 native_error,actual_error=io.StringIO(),io.StringIO()
 with contextlib.redirect_stderr(native_error):
  try: get_line_parser(None)(line)
  except Exception as error: expected=dict(op='error',type=type(error).__name__,message=str(error))
  else: raise AssertionError('native option parser unexpectedly accepted malformed input')
 with contextlib.redirect_stderr(actual_error): exec(program,{})
 assert messages==[expected],(line,messages,expected)
 assert actual_error.getvalue()==native_error.getvalue(),line
for pyproject in (False,True):
 request=dict(hook='read_editable_requirement',source='/project[FEATURE]')
 messages=[]
 with patch('os.path.isdir',return_value=True),patch('os.path.exists',return_value=False),patch('os.path.isfile',return_value=pyproject):
  try: parse_editable(request['source'])
  except Exception as error: expected=dict(op='error',type=type(error).__name__,message=str(error))
  else: raise AssertionError('native parser unexpectedly accepted a project without setup files')
  exec(program,{})
 assert messages==[expected],(messages,expected)

`],{input:JSON.stringify(pythonBuildBackendProgram),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
