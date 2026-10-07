import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

test('native package resolver applies constraints without installing unused roots',async()=>{
 const source=await readFile(new URL('./package-program.py',import.meta.url),'utf8');
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import ast,asyncio,json,sys,types
from pip._vendor.packaging.requirements import Requirement
from pip._vendor.packaging.utils import canonicalize_name,parse_wheel_filename
from urllib.parse import urlsplit
source=json.load(sys.stdin)
selected=[node for node in ast.parse(source).body if isinstance(node,ast.AsyncFunctionDef) and node.name=='_safe_resolve']
calls=[]
class Transaction:
 ctx={}
 ctx_extras=[]
 async def add_requirement_inner(self,req):calls.append(req)
pm=types.ModuleType('micropip.package_manager');pm.Transaction=Transaction
micropip=types.ModuleType('micropip');micropip.package_manager=pm
sys.modules['micropip']=micropip;sys.modules['micropip.package_manager']=pm
async def install(requirements,**options):
 for req in requirements:await pm.Transaction().add_requirement_inner(Requirement(req))
def wheel(url):
 name,version,_,_=parse_wheel_filename(urlsplit(url).path.rsplit('/',1)[-1])
 return types.SimpleNamespace(name=name,version=version)
namespace={'_SafeWheelInfo':types.SimpleNamespace(from_url=wheel),'_SafeRequirement':Requirement,'_safe_name':canonicalize_name,'_safe_preloaded':set(),'_safe_metadata':types.SimpleNamespace(distributions=lambda:iter(())),'_safe_manager':types.SimpleNamespace(install=install),'_safe_validate':lambda roots:None,'_safe_package_pre':False}
exec(compile(ast.Module(body=selected,type_ignores=[]),'<resolver>','exec'),namespace)
async def verify():
 managed=await namespace['_safe_resolve']([Requirement('root[feature]>=1')],constraints=['root<3','root!=2','unused==9','root<1; python_version < "1"'])
 assert managed=={'root'},managed
 assert len(calls)==1 and calls[0].name=='root',calls
 assert calls[0].extras=={'feature'}
 assert calls[0].specifier.contains('1') and not calls[0].specifier.contains('2') and not calls[0].specifier.contains('3'),calls[0]
 assert pm.Transaction is Transaction
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
asyncio.run(verify())
`],{input:JSON.stringify(source),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
