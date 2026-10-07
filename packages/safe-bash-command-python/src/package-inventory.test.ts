import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {loadPythonPackageProgram} from './package-program.js';

for(const mode of ['install','remove','missing','decline'])test('package inventory streams distribution objects and reads only required versions; '+mode,async()=>{
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import ast, asyncio, json, sys, types
source, mode = json.load(sys.stdin)
tree = ast.parse(source)
start = next(index for index, node in enumerate(tree.body) if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == '_safe_managed' for target in node.targets))
code = compile(ast.Module(body=tree.body[start:], type_ignores=[]), '<package-inventory>', 'exec', flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
live = peak = 0
removed = False
output = []
class Distribution:
 def __init__(self, name):
  global live, peak
  self.name = name
  self._path = '/installed/' + name
  live += 1
  peak = max(peak, live)
  assert live <= 3, 'inventory retained discovered distribution objects: ' + str(live)
 def __del__(self):
  global live
  live -= 1
 @property
 def metadata(self): return {'Name': self.name}
 @property
 def version(self):
  assert self.name in ('active', 'remove'), 'unmanaged version read: ' + self.name
  return {'active':'1', 'remove':'2'}[self.name]
 def read_text(self, name): return 'file:///active.whl' if name == 'PYODIDE_URL' and self.name == 'active' else None
class Missing(Exception): pass
def distributions():
 for index in range(512): yield Distribution('host-' + str(index))
 yield Distribution('active')
 if not removed: yield Distribution('remove')
def distribution(name):
 if name != 'remove' or removed: raise Missing(name)
 return Distribution(name)
def uninstall(names):
 global removed
 assert names == ['remove']
 removed = True
async def resolve(*args): return {'active'}
async def emit(channel, value): output.append((channel, value))
async def line(): return 'n'
records = {name:[name, 'metadata', '', [], [], None] for name in ('active','remove')}
namespace = {
 '_safe_package_noDeps':False, '_safe_package_constraints_json':'[]', '_safe_json':json, '_safe_resolve':resolve, '_safe_roots':[], '_safe_package_upgrade':False, '_safe_package_forceReinstall':False,
 '_safe_metadata':types.SimpleNamespace(distributions=distributions, distribution=distribution, PackageNotFoundError=Missing, MetadataPathFinder=types.SimpleNamespace(invalidate_caches=lambda:None)),
 '_safe_name':lambda value:value.lower(), '_SafeRequirement':lambda value:types.SimpleNamespace(name=value),
 '_safe_uninstall':None if mode == 'install' else {'packages':['missing' if mode == 'missing' else 'remove'], 'yes':mode != 'decline'},
 '_safe_preloaded':set(), '_safe_restored_names':{'remove'}, '_safe_package_emit':emit, '_safe_package_line':line,
 '_safe_manager':types.SimpleNamespace(uninstall=uninstall), '_safe_snapshot_paths':{name:'/installed/'+name for name in records}, '_safe_record_by_name':records,
}
asyncio.run(eval(code, namespace))
expected = ['file:///active.whl', 'active==1']
# Origins keep the normalized package name in the saved direct requirement.
expected[0] = 'active @ ' + expected[0]
if mode != 'remove': expected.append('remove==2')
assert json.loads(namespace['_safe_installed_json']) == expected
assert json.loads(namespace['_safe_records_json']) == [records[name] for name in ('active','remove') if name != 'remove' or mode != 'remove']
assert json.loads(namespace['_safe_uninstalled_json']) == (['remove-2'] if mode == 'remove' else [])
if mode == 'missing': assert output == [('stderr', 'WARNING: Skipping missing as it is not installed.\n')]
if mode == 'decline': assert output[-1] == ('stdout', 'Proceed (Y/n)? ')
assert peak <= 3
`],{input:JSON.stringify([await loadPythonPackageProgram(),mode]),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
