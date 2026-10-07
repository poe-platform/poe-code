import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

test('package graph expansion consumes dependency requirements lazily and preserves resolution',()=>{
 const source=readFileSync(new URL('./package-program.py',import.meta.url),'utf8');
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import ast,asyncio,gc,json,sys,types
from pip._vendor.packaging.requirements import Requirement as NativeRequirement
from pip._vendor.packaging.utils import canonicalize_name
class Requirement(NativeRequirement):
 live=peak=created=0
 def __init__(self,value):
  super().__init__(value);self.counted=True
  Requirement.created+=1
  # Discard incidental unreachable parser cycles at a fixed sampling interval.
  if Requirement.created%64==0:gc.collect()
  Requirement.live+=1;Requirement.peak=max(Requirement.peak,Requirement.live)
 def __del__(self):
  if getattr(self,'counted',False):Requirement.live-=1
class Transaction:pass
pm=types.ModuleType('micropip.package_manager');pm.Transaction=Transaction
micropip=types.ModuleType('micropip');micropip.package_manager=pm
sys.modules['micropip']=micropip;sys.modules['micropip.package_manager']=pm
def dist(name,version='1',requires=()):return types.SimpleNamespace(metadata={'Name':name},version=version,requires=requires)
distributions=[];calls=[];repair=True
async def install(requirements,**options):
 calls.append((list(requirements),options['deps']))
 if repair and any(value.startswith('leaf') for value in requirements):
  distributions.append(dist('leaf','2'))
namespace={'_SafeRequirement':Requirement,'_safe_name':canonicalize_name,'_safe_preloaded':set(),'_safe_metadata':types.SimpleNamespace(distributions=lambda:iter(distributions)),'_safe_manager':types.SimpleNamespace(install=install),'_safe_validate':lambda roots:None,'_safe_package_pre':False}
tree=ast.parse(json.load(sys.stdin))
selected=[n for n in tree.body if isinstance(n,ast.AsyncFunctionDef) and n.name=='_safe_resolve']
exec(compile(ast.Module(body=selected,type_ignores=[]),'<resolver>','exec'),namespace)
resolve=namespace['_safe_resolve']
async def verify():
 distributions[:]=[dist('root',requires=['leaf>=1']*1024),dist('leaf')]
 assert await resolve([Requirement('root')])=={'root','leaf'}
 assert Requirement.peak<=68,('retained dependency requirement objects',Requirement.peak)
 # Extras become active on a subsequent graph pass; false markers stay absent.
 distributions[:]=[dist('leaf'),dist('middle',requires=['leaf>=2; extra == "feature"','ignored; python_version < "1"']),dist('root',requires=['middle[feature]','root'])]
 calls.clear()
 assert await resolve([Requirement('root')],constraints=['leaf<3'])=={'root','middle','leaf'}
 assert len(calls)==2 and calls[0][0]==['root'],calls
 pending=NativeRequirement(calls[1][0][0])
 assert pending.name=='leaf' and pending.specifier.contains('2') and not pending.specifier.contains('3'),calls
 # Native enumeration's last duplicate version wins, even when it occurs after
 # the distribution that declares the dependency.
 distributions[:]=[dist('leaf','0'),dist('root',requires=['leaf>=2']),dist('leaf','2')]
 calls.clear()
 assert await resolve([Requirement('root')])=={'root','leaf'}
 assert len(calls)==1,calls
 calls.clear()
 assert await resolve([Requirement('root')],no_deps=True)=={'root'}
 assert calls==[(['root'],False)],calls
 global repair
 repair=False;distributions[:]=[dist('root',requires=['missing>=1'])];calls.clear()
 try:await resolve([Requirement('root')])
 except ValueError as error:assert str(error)=='Python package dependencies remain missing: missing>=1'
 else:raise AssertionError('unresolved graph admitted')
 assert len(calls)==2 and pm.Transaction is Transaction,calls
asyncio.run(verify())
`],{input:JSON.stringify(source),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
