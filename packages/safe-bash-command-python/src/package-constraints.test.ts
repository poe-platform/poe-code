import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

test('native package resolver applies constraints without installing unused roots',async()=>{
 const source=await readFile(new URL('./package-program.py',import.meta.url),'utf8');
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import ast,asyncio,gc,json,sys,types
from pip._vendor.packaging.requirements import Requirement as NativeRequirement
from pip._vendor.packaging.utils import canonicalize_name,parse_wheel_filename
from urllib.parse import urlsplit
source=json.load(sys.stdin)
selected=[node for node in ast.parse(source).body if isinstance(node,(ast.AsyncFunctionDef,ast.ClassDef)) and node.name in ('_safe_resolve','_SafeRequirements')]
calls=[]
class Requirement(NativeRequirement):
 live=0
 def __init__(self,value):
  super().__init__(value);self.counted=True;Requirement.live+=1
 def __del__(self):
  if getattr(self,'counted',False):Requirement.live-=1
expected_constraints=None
class Transaction:
 ctx={}
 ctx_extras=[]
 async def add_requirement_inner(self,req):calls.append(req)
pm=types.ModuleType('micropip.package_manager');pm.Transaction=Transaction
micropip=types.ModuleType('micropip');micropip.package_manager=pm
sys.modules['micropip']=micropip;sys.modules['micropip.package_manager']=pm
async def install(requirements,**options):
 gc.collect();assert Requirement.live<=8,('parsed constraints retained',Requirement.live)
 if expected_constraints is not None:assert options['constraints']==expected_constraints
 for req in requirements:await pm.Transaction().add_requirement_inner(Requirement(req))
def wheel(url):
 name,version,_,_=parse_wheel_filename(urlsplit(url).path.rsplit('/',1)[-1])
 return types.SimpleNamespace(name=name,version=version)
namespace={'_SafeWheelInfo':types.SimpleNamespace(from_url=wheel),'_SafeRequirement':Requirement,'_safe_name':canonicalize_name,'_safe_preloaded':set(),'_safe_metadata':types.SimpleNamespace(distributions=lambda:iter(())),'_safe_manager':types.SimpleNamespace(install=install),'_safe_validate':lambda roots:None,'_safe_package_pre':False}
class Names(set):
 def close(self):pass
class Values(dict):
 put=dict.__setitem__
 def close(self):pass
class Resolutions(set):
 def repeated(self,requirements):
  key=frozenset(requirements)
  if key in self:return True
  self.add(key);return False
 def close(self):pass
namespace.update(_SafeNames=Names,_SafeValues=Values,_SafeResolutions=Resolutions)
exec(compile(ast.Module(body=selected,type_ignores=[]),'<resolver>','exec'),namespace)
async def verify():
 managed=await namespace['_safe_resolve']([Requirement('root[feature]>=1')],constraints=['root<3','root!=2','unused==9','root<1; python_version < "1"'])
 assert managed=={'root'},managed
 assert len(calls)==1 and calls[0].name=='root',calls
 assert calls[0].extras=={'feature'}
 assert calls[0].specifier.contains('1') and not calls[0].specifier.contains('2') and not calls[0].specifier.contains('3'),calls[0]
 assert pm.Transaction is Transaction
 calls.clear()
 await namespace['_safe_resolve']([Requirement('root[first]>=1'),Requirement('root[second]<3')])
 assert len(calls)==2 and all(req.extras=={'first','second'} for req in calls),calls
 assert calls[0].specifier.contains('3') and not calls[1].specifier.contains('3')
 calls.clear()
 await namespace['_safe_resolve']([Requirement('root>=1; python_version >= \"3\"')],constraints=['root<3'])
 assert len(calls)==1 and calls[0].specifier.contains('1')
 calls.clear()
 inactive=await namespace['_safe_resolve']([Requirement('root; python_version < \"1\"')],constraints=['root @ https://example.test/root-2-py3-none-any.whl','root @ https://example.test/root-1-py3-none-any.whl'])
 assert inactive==set() and not calls
 await namespace['_safe_resolve']([Requirement('root[feature]>=1')],constraints=['root @ https://example.test/root-2-py3-none-any.whl','root<3'])
 assert len(calls)==1 and calls[0].extras=={'feature'} and calls[0].url=='https://example.test/root-2-py3-none-any.whl'
 for constraints in [['root @ https://example.test/root-2-py3-none-any.whl','root<2'],['root @ https://example.test/root-2-py3-none-any.whl','root @ https://example.test/root-1-py3-none-any.whl']]:
  try:await namespace['_safe_resolve']([Requirement('root')],constraints=constraints)
  except ValueError:pass
  else:raise AssertionError('conflicting direct constraint admitted')
 for invalid in ['unused[extra]==1','invalid constraint ?']:
  try:await namespace['_safe_resolve']([Requirement('root')],constraints=[invalid])
  except ValueError:pass
  else:raise AssertionError('invalid constraint silently discarded: '+invalid)
 assert pm.Transaction is Transaction
 global expected_constraints
 expected_constraints=['unused-'+str(i)+'<2' for i in range(1024)]
 for no_deps in [False,True]:
  calls.clear()
  assert await namespace['_safe_resolve']([Requirement('root')],constraints=expected_constraints,no_deps=no_deps)=={'root'}
  assert len(calls)==1 and calls[0].name=='root'
asyncio.run(verify())
`],{input:JSON.stringify(source),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
