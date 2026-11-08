import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {pythonBuildBackendProgram} from './build-backend.js';

const python=process.env.LLM_TEST_PYTHON??'python3';
const available=spawnSync(python,['-B','-c','import pip; assert pip.__version__ == "21.2.4"'],{timeout:5000}).status===0;
test('legacy setup execution matches pinned pip shim globals, arguments and wheel selection',{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned pip==21.2.4':false},()=>{
 const result=spawnSync(python,['-B','-c',String.raw`
import contextlib, io, json, os, sys, types, setuptools
from unittest.mock import patch
from pip._internal.utils.setuptools_build import make_setuptools_bdist_wheel_args
from pip._internal.operations.build.wheel_legacy import get_legacy_build_wheel_path
program=json.load(sys.stdin)
request=dict(hook='build_legacy_wheel',source='/source',wheelDirectory='/wheels')
arguments=make_setuptools_bdist_wheel_args('/source/setup.py',[],[],'/wheels')
script=arguments[arguments.index('-c')+1]
for source in ["print(repr((__name__, __file__, sys.argv, sys.path[0], setuptools.__name__, tokenize.__name__)))", "raise ValueError('legacy backend failed')", "raise SystemExit(0)"]:
 for names in [['fixture-1-py3-none-any.whl'],['z-1-py3-none-any.whl','a-1-py3-none-any.whl']]:
  messages=[]
  def send(capability,message):
   assert capability=='python_build'
   if message['op']=='request':return request
   messages.append(message)
  sys.modules['safe_host']=types.SimpleNamespace(call=send)
  actual_out,expected_out=io.StringIO(),io.StringIO()
  with patch('os.chdir'),patch('os.path.exists',return_value=True),patch('tokenize.open',side_effect=lambda _:io.StringIO(source)),patch('os.scandir',return_value=contextlib.nullcontext(iter(types.SimpleNamespace(name=name) for name in names))),contextlib.redirect_stdout(actual_out):
   exec(program,{})
  sys.argv=['-c']+arguments[arguments.index('-c')+2:]
  sys.path[0]=''
  failure=None
  with patch('os.path.exists',return_value=True),patch('tokenize.open',side_effect=lambda _:io.StringIO(source)),contextlib.redirect_stdout(expected_out):
   try:exec(script,dict(__name__='__main__'))
   except SystemExit as error:
    assert error.code in (None,0)
   except Exception as error:failure=error
  assert actual_out.getvalue()==expected_out.getvalue(),(actual_out.getvalue(),expected_out.getvalue())
  if failure:assert messages==[dict(op='error',type=type(failure).__name__,message=str(failure))],messages
  else:
   expected=os.path.basename(get_legacy_build_wheel_path(names,'/wheels','fixture',arguments,''))
   assert messages[-1]==dict(op='done')
   assert json.loads(''.join(message['text'] for message in messages[:-1]))==expected
`],{input:JSON.stringify(pythonBuildBackendProgram),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
