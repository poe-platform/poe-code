import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {pythonBuildBackendProgram} from './build-backend.js';

const python=process.env.LLM_TEST_PYTHON??'python3';
const available=spawnSync(python,['-B','-c','import pip; assert pip.__version__ == "21.2.4"'],{timeout:5000}).status===0;
test('build-system selection, requirement validation and errors match pinned pip without touching host files',{
 skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned pip==21.2.4':false
},()=>{
 const result=spawnSync(python,['-B','-c',String.raw`
import io, json, sys, types
from unittest.mock import patch
import pip
assert pip.__version__ == '21.2.4'
from pip._internal.pyproject import load_pyproject_toml
from pip._vendor import tomli
from pip._vendor.packaging import requirements
sys.modules['tomllib']=tomli
sys.modules['micropip._vendored.packaging.src.packaging.requirements']=requirements
program=json.load(sys.stdin)
fixtures=[None,'','[tool.fixture]\nvalue="界"','[build-system]','[build-system]\nrequires="wheel"','[build-system]\nrequires=[1]','[build-system]\nrequires=["bad @@@"]','[build-system]\nrequires=[]','[build-system]\nrequires=["wheel", "helper; python_version >= \'3\'"]','[build-system]\nrequires=["wheel"]\nbuild-backend="custom:factory"\nbackend-path=[".","src"]','[build-system]\nrequires=["helper[extra]>=1"]\nbuild-backend="custom"']
for text in fixtures:
 for setup in [False,True]:
  for selected in [None,False,True]:
   request=dict(hook='read_build_system',source='/source',name='fixture',maxBytes=4096)
   if selected is not None: request['usePep517']=selected
   messages=[]
   def send(capability,message):
    assert capability=='python_build'
    if message['op']=='request': return request
    messages.append(message)
   sys.modules['safe_host']=types.SimpleNamespace(call=send)
   def isfile(path): return setup if path.endswith('setup.py') else text is not None
   def opened(path,mode='r',**kwargs):
    assert path=='/source/pyproject.toml'
    return io.BytesIO(text.encode()) if 'b' in mode else io.StringIO(text)
   expected_error=None
   with patch('os.path.isfile',side_effect=isfile),patch('builtins.open',side_effect=opened):
    try:
     expected=load_pyproject_toml(selected,'/source/pyproject.toml','/source/setup.py','fixture')
     if expected is not None: expected=dict(requires=expected.requires,backend=expected.backend,check=expected.check,backendPath=expected.backend_path)
    except Exception as error: expected_error=dict(op='error',type=type(error).__name__,message=str(error))
    exec(program,{})
   if expected_error: assert messages==[expected_error],(request,text,messages,expected_error)
   else:
    assert messages[-1]==dict(op='done'),(request,text,messages)
    assert json.loads(''.join(message['text'] for message in messages[:-1]))==expected

# A bounded binary read must refuse before TOML parsing, including multibyte text.
request=dict(hook='read_build_system',source='/source',maxBytes=5)
messages=[]
class Bounded(io.BytesIO):
 def read(self,size=-1):
  assert size==6,size
  return super().read(size)
with patch('os.path.isfile',return_value=True),patch('builtins.open',return_value=Bounded('界界界'.encode())):
 exec(program,{})
assert messages==[dict(op='error',type='ValueError',message='Python build configuration limit exceeded')],messages
`],{input:JSON.stringify(pythonBuildBackendProgram),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
