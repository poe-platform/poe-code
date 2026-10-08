import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

for(const mode of ['large','empty','egg','decode-error','early','custom','custom-instance','storage-error','empty-header','folded','surrogate','metadata-lifetime'])test('native distribution requirements preserve order and fallback with caller backing: '+mode,()=>{
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import ast,email.message,importlib.metadata as metadata,json,pathlib,sys,weakref
from unittest.mock import patch
source,mode=json.load(sys.stdin)
stores=[];references=[];tracking=False
class Values:
 def __init__(self):self.values={};self.closed=False;stores.append(self)
 def put(self,key,value):
  if mode=='storage-error':raise OSError('storage denied')
  self.values[key]=value
 def get(self,key):return self.values[key]
 def __iter__(self):return iter(self.values)
 def __len__(self):return len(self.values)
 def close(self):self.closed=True
namespace={'_safe_distribution_metadata':lambda distribution:distribution.metadata,'_safe_metadata':metadata,'_SafeValues':Values}
tree=ast.parse(source)
selected=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name in ('_safe_header_values','_safe_distribution_requires')]
exec(compile(ast.Module(body=selected,type_ignores=[]),'<requirements>','exec'),namespace)
files={'METADATA':'Name: fixture\n'+''.join('Requires-Dist: package-'+str(i)+'; python_version >= "3"\n' for i in range(1024))}
if mode in ('empty','egg'):files={'METADATA':'Name: fixture\n','requires.txt':'base>=1\n[extra:python_version >= "3"]\nchild @ https://example.test/wheel.whl\n'} if mode=='egg' else {'METADATA':'Name: fixture\n'}
if mode=='empty-header':files={'METADATA':'Name: fixture\nRequires-Dist:\n'}
if mode=='folded':files={'METADATA':'Name: fixture\nRequires-Dist: first;\n        python_version >= "3"\nRequires-Dist: second\nRequires-Dist: first\n'}
if mode=='surrogate':files={'METADATA':'Name: fixture\nRequires-Dist: invalid-\udcff\n'}
def read_text(self,name):
 if mode=='decode-error':raise UnicodeDecodeError('utf-8',b'\xff',0,1,'invalid start byte')
 return files.get(name)
class Custom(metadata.PathDistribution):
 @property
 def requires(self):return ['custom']
dist=Custom(pathlib.Path('/fixture.dist-info')) if mode=='custom' else metadata.PathDistribution(pathlib.Path('/fixture.dist-info'))
if mode=='custom-instance':dist._read_dist_info_reqs=lambda:['instance']
native_metadata=metadata.PathDistribution.metadata.fget
def tracked_metadata(self):
 value=native_metadata(self);references.append(weakref.ref(value));return value
original=email.message.Message.get_all
def get_all(self,name,*args):
 if tracking:assert sum(key.lower()==name.lower() for key,value in self.raw_items())<=2,'native header list materialized'
 return original(self,name,*args)
with patch.object(metadata.PathDistribution,'metadata',property(tracked_metadata)),patch.object(metadata.PathDistribution,'read_text',read_text),patch.object(email.message.Message,'get_all',get_all):
 failure=None
 try:expected=list(dist.requires or ())
 except Exception as error:failure=(type(error),str(error))
 tracking=not mode.startswith('custom') and mode!='surrogate'
 iterator=namespace.get('_safe_distribution_requires',lambda value:iter(value.requires or ()))(dist)
 try:
  if mode in ('early','metadata-lifetime'):
   next(iterator)
   if mode=='metadata-lifetime':assert all(reference() is None for reference in references),'parsed metadata retained during backed requirement consumption'
  else:actual=list(iterator)
 except Exception as error:
  if mode=='storage-error':assert (type(error),str(error))==(OSError,'storage denied')
  else:assert failure==(type(error),str(error)),(failure,type(error),str(error))
 else:
  assert failure is None
  if mode not in ('early','metadata-lifetime'):assert actual==expected
  assert mode!='storage-error','caller backing was bypassed'
 finally:
  if hasattr(iterator,'close'):iterator.close()
assert all(store.closed for store in stores)
if mode in ('large','early','egg'):assert stores,'requirements did not use caller storage'
`],{input:JSON.stringify([readFileSync(new URL('./package-program.py',import.meta.url),'utf8'),mode]),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
