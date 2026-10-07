import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {pythonNativeWheel} from './native-wheel.js';

test('native wheel directory parsing does not materialize the complete central directory',()=>{
 const reference=readFileSync(new URL('./fixtures/pinned-wheel-metadata.py',import.meta.url),'utf8');
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import io,json,linecache,sys,types,zipfile
program,reference=json.load(sys.stdin)
sys.modules['pyodide']=types.SimpleNamespace(_package_loader=types.SimpleNamespace())
sys.modules['pyodide.ffi']=types.SimpleNamespace(run_sync=lambda value:value)
reference='from __future__ import annotations\n'+reference
filename='<pinned wheel metadata>'
linecache.cache[filename]=(len(reference),None,reference.splitlines(True),filename)
metadata=types.ModuleType('micropip.metadata')
metadata.canonicalize_name=lambda name:name.lower().replace('_','-')
metadata.UnsupportedWheel=ValueError
exec(compile(reference,filename,'exec'),metadata.__dict__)
sys.modules['micropip.metadata']=metadata
class ObservedBuffer(bytearray):
 maximum=0
 def extend(self,value):
  super().extend(value)
  ObservedBuffer.maximum=max(ObservedBuffer.maximum,len(self))
for count in [512,4096]:
 output=io.BytesIO()
 with zipfile.ZipFile(output,'w') as archive:
  archive.writestr('fixture-1.0.dist-info/METADATA','Name: fixture\nVersion: 1.0\n')
  for index in range(count):archive.writestr('fixture/data/%08d.dat'%index,b'')
 payload=output.getvalue()
 original=zipfile.ZipFile._RealGetContents
 reads=[]
 def read(offset,length):
  assert length<=65536
  reads.append(length)
  return payload[offset:offset+min(length,8191)]
 namespace={'bytearray':ObservedBuffer,'_safe_native_wheel_read':read,'_safe_native_wheel_config':json.dumps(dict(size=len(payload),metadata_name='fixture'))}
 exec(program,namespace)
 actual=namespace['_safe_extract_native_wheel'](read,namespace['_safe_native_wheel_config'])
 assert json.loads(actual)=='Name: fixture\nVersion: 1.0\n'
 assert zipfile.ZipFile._RealGetContents is original,'native parser patch leaked'
 assert ObservedBuffer.maximum<=65558,(count,ObservedBuffer.maximum)
 def failed_read(offset,length):raise OSError('interrupted retained read')
 try:namespace['_safe_extract_native_wheel'](failed_read,namespace['_safe_native_wheel_config'])
 except zipfile.BadZipFile:pass
 else:raise AssertionError('failed source accepted')
 assert zipfile.ZipFile._RealGetContents is original,'failed source leaked parser patch'
`],{input:JSON.stringify([pythonNativeWheel,reference]),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
