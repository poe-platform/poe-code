import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {pythonBuildBackendProgram} from './build-backend.js';

const python=process.env.LLM_TEST_PYTHON??'python3';
const available=spawnSync(python,['-B','-c','import pip; assert pip.__version__ == "21.2.4"'],{timeout:5000}).status===0;
test('native build hook calls match pinned pip PEP 517 requirements, wheel arguments and failures',{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned pip==21.2.4':false},()=>{
 const result=spawnSync(python,['-B','-c',String.raw`
import contextlib, io, json, os, sys, types
from unittest.mock import patch
import pip
assert pip.__version__ == '21.2.4'
from pip._vendor.pep517.in_process import _in_process as reference
program=json.load(sys.stdin)
calls=[]
def requirements(settings):
 calls.append(('requires',settings))
 print('backend output')
 print('backend diagnostic',file=sys.stderr)
 if settings and settings.get('fail'): raise ValueError('backend rejected configuration')
 return ['helper==1','extra; python_version >= "3"']
def wheel(directory,settings,metadata):
 calls.append(('wheel',directory,settings,metadata))
 return 'fixture-1-py3-none-any.whl'
module=types.ModuleType('fixture_backend')
module.__file__='/source/backend.py'
module.factory=types.SimpleNamespace(get_requires_for_build_wheel=requirements,build_wheel=wheel)
sys.modules['fixture_backend']=module
for hook in ('get_requires_for_build_wheel','build_wheel'):
 for settings in (None,{},dict(feature=['one','two']),dict(fail='yes')):
  request=dict(source='/source',backend='fixture_backend:factory',backendPath=['.'],hook=hook)
  if settings is not None: request['configSettings']=settings
  if hook=='build_wheel': request.update(wheelDirectory='/wheels',metadataDirectory='/metadata')
  messages=[]
  def send(capability,message):
   assert capability=='python_build'
   if message['op']=='request': return request
   messages.append(message)
  sys.modules['safe_host']=types.SimpleNamespace(call=send)
  actual_out,actual_err=io.StringIO(),io.StringIO()
  calls.clear()
  with patch('os.chdir'),contextlib.redirect_stdout(actual_out),contextlib.redirect_stderr(actual_err): exec(program,{})
  actual_calls=calls[:]
  calls.clear()
  expected_out,expected_err=io.StringIO(),io.StringIO()
  error=None
  with patch.dict(os.environ,PEP517_BUILD_BACKEND='fixture_backend:factory',PEP517_BACKEND_PATH='/source'),contextlib.redirect_stdout(expected_out),contextlib.redirect_stderr(expected_err):
   try: expected=getattr(reference,hook)(settings) if hook=='get_requires_for_build_wheel' else reference.build_wheel('/wheels',settings,'/metadata')
   except Exception as caught: error=caught
  assert actual_calls==calls,(actual_calls,calls)
  assert actual_out.getvalue()==expected_out.getvalue()
  assert actual_err.getvalue()==expected_err.getvalue()
  if error:
   assert messages==[dict(op='error',type=type(error).__name__,message=str(error))]
  else:
   assert messages[-1]==dict(op='done')
   assert json.loads(''.join(message['text'] for message in messages[:-1]))==expected

# An absent optional hook differs from an explicitly non-callable hook.
for value in ('absent',None):
 if value=='absent': del module.factory.get_requires_for_build_wheel
 else: module.factory.get_requires_for_build_wheel=value
 request=dict(source='/source',backend='fixture_backend:factory',hook='get_requires_for_build_wheel')
 messages=[]
 with patch('os.chdir'): exec(program,{})
 if value=='absent': assert messages==[dict(op='text',text='[]'),dict(op='done')]
 else: assert messages[0]['op']=='error' and messages[0]['type']=='TypeError'

for paths,message in [(['/outside'],'paths must be relative'),(['../outside'],'paths must be inside source tree'),(['inside'],'Backend was not loaded from backend-path')]:
 request=dict(source='/source',backend='fixture_backend:factory',backendPath=paths,hook='get_requires_for_build_wheel')
 messages=[]
 with patch('os.chdir'): exec(program,{})
 assert messages==[dict(op='error',type='ValueError',message=message)],messages
`],{input:JSON.stringify(pythonBuildBackendProgram),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
