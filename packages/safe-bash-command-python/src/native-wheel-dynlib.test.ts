import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {pythonNativeWheel} from './native-wheel.js';

test('native library discovery preserves pinned filtering and emits each resolved path before advancing',()=>{
 const reference=readFileSync(new URL('./fixtures/pinned-dynlib-loader.py',import.meta.url),'utf8');
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import io,json,linecache,sys,types,zipfile
from pathlib import Path
from unittest.mock import patch
program,reference=json.load(sys.stdin)
filename='<pinned dynlib loader>'
linecache.cache[filename]=(len(reference),None,reference.splitlines(True),filename)
loader=types.ModuleType('pyodide._package_loader')
exec(compile(reference,filename,'exec'),loader.__dict__)
sys.modules['pyodide']=types.SimpleNamespace(_package_loader=loader)
sys.modules['pyodide.ffi']=types.SimpleNamespace(run_sync=lambda value:value.settle())
output=io.BytesIO()
with zipfile.ZipFile(output,'w') as archive:
 for index in range(1024):archive.writestr('fixture/%04d.so'%index,b'')
 for name in ['plain.txt','valid.abi3.so','native.cpython-314-wasm32-emscripten.so','foreign.cpython-311-x86_64-linux-gnu.so','version.so.1']:
  archive.writestr(name,b'')
payload=output.getvalue()
expected=loader.get_dynlibs(io.BytesIO(payload),'.zip',Path('/virtual'))
resolved=0
emitted=[]
resolve=Path.resolve
def observe(path,*args,**kwargs):
 global resolved
 resolved+=1
 assert resolved-len(emitted)<=1,'native library paths accumulated before consumption'
 return resolve(path,*args,**kwargs)
class Completion:
 then=True
 def __init__(self,path,fail=False):self.path,self.fail=path,fail
 def settle(self):
  if self.fail:return 'native library rejected'
  emitted.append(self.path)
  return ''
def emit(path):return Completion(path)
namespace={'_safe_native_wheel_read':lambda offset,length:payload[offset:offset+length], '_safe_native_wheel_config':json.dumps(dict(size=len(payload),filename='fixture.zip',extract_dir='/virtual')), '_safe_native_wheel_dynlib':emit}
with patch.object(Path,'mkdir'),patch('shutil._unpack_zipfile'),patch.object(Path,'resolve',observe):
 exec(program,namespace)
assert emitted==expected,(len(emitted),len(expected))
assert loader.get_dynlibs(io.BytesIO(payload),'.zip',Path('/virtual'))==expected,'pinned helper mutated'
resolved=0
emitted.clear()
def reject(path):return Completion(path,fail=len(emitted)==2)
namespace['_safe_native_wheel_dynlib']=reject
with patch.object(Path,'mkdir'),patch('shutil._unpack_zipfile'),patch.object(Path,'resolve',observe):
 failure=namespace['_safe_extract_native_wheel'](namespace['_safe_native_wheel_read'],namespace['_safe_native_wheel_config'])
 assert json.loads(failure)=={'dynlibError':'native library rejected'}
assert emitted==expected[:2] and resolved==3,'discovery advanced beyond failed library'
`],{input:JSON.stringify([pythonNativeWheel,reference]),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
