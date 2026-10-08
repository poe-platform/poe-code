import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {loadPythonPackageProgram} from './package-program.js';

for(const noDeps of [false,true])for(const stalls of [false,true])test('dependency closure streams distribution scans and preserves extras and convergence; stalls='+stalls+'; noDeps='+noDeps,async()=>{
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import ast, asyncio, json, sys, types
from pip._vendor.packaging.requirements import Requirement
from pip._vendor.packaging.utils import canonicalize_name
source, stalls, no_deps = json.load(sys.stdin)
tree = ast.parse(source)
selected = [node for node in tree.body if isinstance(node, (ast.AsyncFunctionDef, ast.ClassDef)) and node.name in ('_safe_resolve', '_SafeRequirements')]
assert len(selected) == 2
live = peak = 0
versions = {'root':'1', 'child':'1'}
calls = []
class Distribution:
 def __init__(self, name):
  global live, peak
  self.name = name
  live += 1
  peak = max(peak, live)
  assert live <= 3, 'resolver retained distribution objects: ' + str(live)
 def __del__(self):
  global live
  live -= 1
 @property
 def metadata(self): return {'Name':self.name}
 @property
 def version(self):
  assert self.name in versions, 'unmanaged version read: ' + self.name
  return versions[self.name]
 @property
 def requires(self):
  return {'root':['child[feature]>=2', 'ignored; python_version < "1"'], 'child':['leaf; extra == "feature"'], 'leaf':[]}[self.name]
def distributions():
 for index in range(512): yield Distribution('host-' + str(index))
 for name in ('leaf','child','root'):
  if name in versions: yield Distribution(name)
async def install(requirements, **options):
 calls.append((requirements, options))
 if len(calls) > 1 and not stalls: versions.update(child='2', leaf='1')
def validate(roots):
 for root in roots: assert root.specifier.contains(versions[root.name], prereleases=True)
micropip = types.ModuleType('micropip')
pm = types.ModuleType('micropip.package_manager')
pm.Transaction = type('Transaction', (), {})
original = pm.Transaction
micropip.package_manager = pm
sys.modules['micropip'] = micropip
sys.modules['micropip.package_manager'] = pm
namespace = {'_safe_distribution_metadata':lambda distribution:distribution.metadata,'_safe_distribution_requires':lambda distribution:(value for value in distribution.requires or ()),'_SafeRequirement':Requirement, '_safe_name':canonicalize_name, '_safe_preloaded':set(), '_safe_metadata':types.SimpleNamespace(distributions=distributions), '_safe_manager':types.SimpleNamespace(install=install), '_safe_validate':validate, '_safe_package_pre':False}
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
exec(compile(ast.Module(body=selected,type_ignores=[]), '<package-resolution>', 'exec'), namespace)
try:
 result = asyncio.run(namespace['_safe_resolve']([Requirement('root')], no_deps=no_deps))
 assert not stalls or no_deps
 assert result == {'root'} if no_deps else result == {'root','child','leaf'}, result
except ValueError as error:
 assert stalls and str(error) == 'Python package dependencies remain missing: child[feature]>=2, leaf', str(error)
assert calls == ([(['root'], {'deps':False, 'pre':False, 'reinstall':True})] if no_deps else [(['root'], {'deps':True, 'pre':False, 'reinstall':True}), (['child[feature]>=2','leaf'], {'deps':True, 'pre':False, 'reinstall':True})]), calls
assert pm.Transaction is original
assert peak == 0 if no_deps else peak <= 3
`],{input:JSON.stringify([await loadPythonPackageProgram(),stalls,noDeps]),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
