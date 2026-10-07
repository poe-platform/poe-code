import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {pythonNativeWheel} from './native-wheel.js';

test('wheel metadata discovery bounds ordinary directory retention and preserves native ambiguous selection',()=>{
 const reference=readFileSync(new URL('./fixtures/pinned-wheel-metadata.py',import.meta.url),'utf8');
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import io,json,linecache,sys,types,zipfile
from pathlib import Path
from unittest.mock import patch
program,reference=json.load(sys.stdin)
reference='from __future__ import annotations\n'+reference
filename='<pinned wheel metadata>'
linecache.cache[filename]=(len(reference),None,reference.splitlines(True),filename)
loader=types.ModuleType('pyodide._package_loader')
loader.canonicalize_name=lambda name:name.lower().replace('_','-')
loader.UnsupportedWheel=ValueError
exec(compile(reference,filename,'exec'),loader.__dict__)
original=loader.find_wheel_metadata_dir
metadata=types.ModuleType('micropip.metadata')
metadata.wheel_dist_info_dir=loader.wheel_dist_info_dir
sys.modules['pyodide']=types.SimpleNamespace(_package_loader=loader)
sys.modules['pyodide.ffi']=types.SimpleNamespace(run_sync=lambda value:value)
sys.modules['micropip.metadata']=metadata
class Root(str):
 live=maximum=0
 def __new__(cls,value):
  obj=super().__new__(cls,value)
  cls.live+=1;cls.maximum=max(cls.maximum,cls.live)
  return obj
 def __del__(self):Root.live-=1
class Name(str):
 def split(self,*args):
  parts=super().split(*args)
  parts[0]=Root(parts[0])
  return parts
class Archive:
 def __init__(self,names):self.names=names
 def namelist(self):return (Name(name) for name in self.names)
output=io.BytesIO()
with zipfile.ZipFile(output,'w'):pass
payload=output.getvalue()
namespace={'_safe_native_wheel_read':lambda offset,length:payload[offset:offset+length], '_safe_native_wheel_config':json.dumps(dict(size=len(payload),filename='fixture.whl',extract_dir='/virtual',metadata={}))}
loader.get_dynlibs=lambda *args:[]
loader.install_datafiles=lambda *args:None
for suffix in ['.dist-info','.data']:
 for matches in [[],['fixture-1.0'+suffix],['fixture-1.0'+suffix,'other-2.0'+suffix]]:
  names=['unrelated-%05d/module.py'%i for i in range(4096)]+[name+'/METADATA' for name in matches for _ in range(3)]
  expected=original(Archive(names),suffix)
  Root.maximum=0
  def check(*args):
   actual=loader.find_wheel_metadata_dir(Archive(names),suffix)
   assert actual==expected,(actual,expected)
   if len(matches)<2:assert Root.maximum<=4,('top-level roots retained',Root.maximum)
  loader.set_wheel_metadata=check
  with patch.object(Path,'mkdir'),patch('shutil._unpack_zipfile'):
   exec(program,namespace)
  assert loader.find_wheel_metadata_dir is original,'helper patch leaked'
# Metadata reads use micropip's stricter duplicate and canonical-name validation.
for matches in [[],['fixture-1.0.dist-info'],['wrong-1.0.dist-info'],['fixture-1.0.dist-info','other-2.0.dist-info']]:
 names=['unrelated-%05d/module.py'%i for i in range(4096)]+[name+'/METADATA' for name in matches for _ in range(3)]
 def outcome(action):
  try:return ('ok',action())
  except ValueError as error:return ('error',str(error))
 expected=outcome(lambda:metadata.wheel_dist_info_dir(Archive(names),'fixture'))
 if expected[0]=='ok':expected=('ok',json.dumps(expected[1]+'/METADATA'))
 Root.maximum=0
 config=json.dumps(dict(size=len(payload),metadata_name='fixture'))
 with patch.object(zipfile.ZipFile,'namelist',lambda archive:Archive(names).namelist()),patch.object(zipfile.Path,'read_text',lambda path,**kwargs:path.at):
  actual=outcome(lambda:namespace['_safe_extract_native_wheel'](namespace['_safe_native_wheel_read'],config))
 assert actual==expected,(actual,expected)
 if len(matches)<2:assert Root.maximum<=4,('micropip roots retained',Root.maximum)
 assert loader.find_wheel_metadata_dir is original,'failed metadata lookup leaked patch'
# Exceptions after installing the helper must restore it too.
with patch.object(Path,'mkdir'),patch('shutil._unpack_zipfile',side_effect=OSError('interrupted extraction')):
 try:namespace['_safe_extract_native_wheel'](namespace['_safe_native_wheel_read'],namespace['_safe_native_wheel_config'])
 except OSError:pass
 else:raise AssertionError('extraction interruption swallowed')
assert loader.find_wheel_metadata_dir is original,'failed extraction leaked helper'
`],{input:JSON.stringify([pythonNativeWheel,reference]),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
