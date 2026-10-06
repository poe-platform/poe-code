import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {pythonNativeWheel} from './native-wheel.js';

const python=process.env.LLM_TEST_PYTHON??'python3';
const available=spawnSync(python,['-B','-c','import pip; assert pip.__version__ == "21.2.4"'],{timeout:5000}).status===0;
test('retained wheel integrity matches pinned pip for every supported URL hash with bounded reads',{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned pip==21.2.4':false},()=>{
 const result=spawnSync(python,['-B','-c',String.raw`
import hashlib, json, sys, types
from pip._internal.utils.hashes import Hashes
program=json.load(sys.stdin)
sys.modules['pyodide']=types.SimpleNamespace(_package_loader=types.SimpleNamespace())
sys.modules['pyodide.ffi']=types.SimpleNamespace(run_sync=lambda value:value)
for size in [0, 196615]:
 payload=bytes(i%251 for i in range(size))
 for algorithm in ['sha1','sha224','sha384','sha256','sha512','md5']:
  for correct in [False, True]:
   expected=hashlib.new(algorithm,payload).hexdigest() if correct else '0'
   def chunks():
    for offset in range(0,len(payload),65536):yield payload[offset:offset+65536]
   try:
    Hashes({algorithm:[expected]}).check_against_chunks(chunks())
    reference=True
   except Exception:reference=False
   reads=[]
   def read(offset,length):
    assert 0<length<=65536
    reads.append((offset,length))
    return payload[offset:offset+min(length,8191)]
   namespace={'_safe_native_wheel_read':read,'_safe_native_wheel_config':json.dumps(dict(size=size,integrity=[algorithm,expected]))}
   try:
    exec(program,namespace)
    actual=True
   except ValueError as error:
    assert 'integrity mismatch' in str(error),error
    actual=False
   assert actual==reference,(algorithm,size,correct)
   assert len(reads)>1 if size else not reads
`],{input:JSON.stringify(pythonNativeWheel),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
