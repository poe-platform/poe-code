import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {loadPythonPackageProgram} from './package-program.js';

test('native record decoding counts UTF-16 windows and preserves escaped strings and legacy rows',async()=>{
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import ast, json, sys, types
from collections.abc import Mapping
source=json.load(sys.stdin)
node=next(node for node in ast.parse(source).body if isinstance(node,ast.ClassDef) and node.name=='_SafeRecords')
ffi=types.ModuleType('pyodide.ffi');ffi.run_sync=lambda value:value
sys.modules['pyodide']=types.ModuleType('pyodide');sys.modules['pyodide.ffi']=ffi
state={'_SafeMapping':Mapping,'_safe_json':json}
exec(compile(ast.Module(body=[node],type_ignores=[]),'<record-window>','exec'),state)
for record in [None,['fixture','x'*8190+'😀'+'x'*20000+'\ud800','origin',['a','b'],[]],['fixture','😀'*10000,'',[],[],None]]:
 wire=json.dumps(record,ensure_ascii=True)
 # Include real supplementary characters in the transport while preserving lone surrogates as JSON escapes.
 wire=wire.replace('\ud83d\ude00','😀')
 encoded=wire.encode('utf-16-le');offsets=[]
 def read(operation,key,offset):
  assert operation=='read' and key==0
  offsets.append(offset)
  end=min(len(encoded),offset*2+16384)
  if end<len(encoded) and 0xd800<=int.from_bytes(encoded[end-2:end],'little')<=0xdbff:end-=2
  return encoded[offset*2:end].decode('utf-16-le')
 state['_safe_package_record']=read
 actual=state['_SafeRecords'].decode('read',0)
 assert actual==(record if record is None or len(record)==6 else record+[None])
 assert offsets[-1]==len(encoded)//2
 assert all(0<b-a<=8192 for a,b in zip(offsets,offsets[1:]))
print('ok')
`],{input:JSON.stringify(await loadPythonPackageProgram()),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'ok');
});
