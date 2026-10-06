import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {pythonBuildBackendProgram} from './build-backend.js';

const python=process.env.LLM_TEST_PYTHON??'python3';
const available=spawnSync(python,['-B','-c','import pip; assert pip.__version__ == "21.2.4"'],{timeout:5000}).status===0;
test('build requirement conflicts, markers and inventory scope match pinned pip',{
 skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned pip==21.2.4':false
},()=>{
 const result=spawnSync(python,['-B','-c',String.raw`
import json,sys,types
from unittest.mock import patch
from importlib.metadata import PackageNotFoundError
import pip
assert pip.__version__=='21.2.4'
from pip._internal.build_env import BuildEnvironment
from pip._vendor.packaging import requirements,utils,version
for name,module in [('requirements',requirements),('utils',utils),('version',version)]:
 sys.modules['micropip._vendored.packaging.src.packaging.'+name]=module
program=json.load(sys.stdin)
inventory={'helper':'1.0','early':'2.0rc1','mixed-name':'3.0','normalized':'1.0-1'}
runtime=dict(inventory,bootstrap='1.0')
def distribution(name):
 name=utils.canonicalize_name(name)
 if name not in runtime: raise PackageNotFoundError(name)
 return types.SimpleNamespace(version=runtime[name])
environment=object.__new__(BuildEnvironment)
environment._lib_dirs=[]
def lookup(name):
 value=inventory.get(utils.canonicalize_name(name))
 return types.SimpleNamespace(version=version.Version(value)) if value else None
for wanted in [[],['helper>=1'],['helper>=2','missing==1'],['missing','missing'],['bootstrap==1'],['MiXeD_Name==3.0'],['helper[feature]==1.0'],['absent; python_version < "1"'],['helper>=2; python_version < "1"'],['early>=2'],['normalized>=2'],['helper @ https://example.test/helper.whl']]:
 request=dict(hook='check_build_requirements',source='/source',requirements=wanted,installed=list(inventory))
 messages=[]
 def send(capability,message):
  assert capability=='python_build'
  if message['op']=='request': return request
  messages.append(message)
 sys.modules['safe_host']=types.SimpleNamespace(call=send)
 with patch('importlib.metadata.distribution',side_effect=distribution):exec(program,{})
 with patch('pip._internal.build_env.get_environment',return_value=types.SimpleNamespace(get_distribution=lookup)):
  conflicting,missing=environment.check_requirements(wanted)
 assert messages[-1]==dict(op='done'),messages
 actual=json.loads(''.join(message['text'] for message in messages[:-1]))
 expected=dict(conflicting=[list(pair) for pair in sorted(conflicting)],missing=sorted(missing))
 assert actual==expected,(wanted,actual,expected)
`],{input:JSON.stringify(pythonBuildBackendProgram),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
