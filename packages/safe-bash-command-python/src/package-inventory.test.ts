import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {loadPythonPackageProgram} from './package-program.js';

for(const mode of ['install','remove','missing','decline','decline-paths','large','pin-failure','file','file-failure','new-file','new-file-large','new-file-write-failure'])test('package inventory streams distribution objects and reads only required versions; '+mode,async()=>{
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import ast, asyncio, json, sys, types
from unittest.mock import patch
source, mode = json.load(sys.stdin)
tree = ast.parse(source)
start = next(index for index, node in enumerate(tree.body) if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == '_safe_managed' for target in node.targets))
code = compile(ast.Module(body=tree.body[start:], type_ignores=[]), '<package-inventory>', 'exec', flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
live = peak = 0
removed = False
output = []
published = []
pins = []
async def record(operation, payload):
 if operation == "pin":
  assert isinstance(payload,str)
  pins.append(json.loads(payload))
  if mode=='pin-failure':raise RuntimeError('pin denied')
  return
 assert operation == "append"
 published.append(json.loads(payload))
class Version(str):
 live=0
 def __new__(cls,value):
  obj=super().__new__(cls,value);cls.live+=1;return obj
 def __del__(self):Version.live-=1
class Headers(dict):
 def get_all(self,key,default):return [self[key]] if key in self else default
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
 def metadata(self): return Headers(Name=self.name, **({'Requires-Dist': '"\\\t\n😀' * 20000} if mode=='new-file-large' else {}))
 @property
 def version(self):
  if self.name.startswith('package-'):return Version('1')
  assert self.name in ('active', 'remove'), 'unmanaged version read: ' + self.name
  return {'active':'1', 'remove':'2'}[self.name]
 def read_text(self, name): return 'file:///'+self.name+'.whl' if name == 'PYODIDE_URL' and (self.name == 'active' or self.name.startswith('package-')) else None
class Missing(Exception): pass
def distributions():
 for index in range(512): yield Distribution('host-' + str(index))
 yield Distribution('active')
 if not removed: yield Distribution('remove')
 if mode=='large':
  for index in range(1024):
   yield Distribution('package-'+str(index))
   assert Version.live<=8,('inventory versions retained',Version.live)
def distribution(name):
 if name != 'remove' or removed: raise Missing(name)
 return Distribution(name)
def uninstall(names):
 global removed
 assert names == ['remove']
 removed = True
closed=[]
class Names(set):
 def close(self):closed.append(self)
class Values(dict):
 def put(self,key,value):self[key]=json.loads(json.dumps(value))
 def ordered(self):return iter(sorted(self))
 def close(self):closed.append(self)
async def resolve(*args): return Names(['active']+['package-'+str(i) for i in range(1024)] if mode=='large' else ['active'])
async def emit(channel, value): output.append((channel, value))
async def line(): return 'n'
class Writer:
 def __init__(self):self.parts=[];self.closed=False
 def write(self,value):
  if mode=='new-file-large':assert len(value)<=49152,('unbounded JSON scalar write',len(value))
  if mode=='file-failure' and self.parts or mode=='new-file-write-failure' and len(self.parts)>10:raise RuntimeError('write denied')
  self.parts.append(value)
 def __enter__(self):return self
 def __exit__(self,*args):self.closed=True
writer=Writer()
class Records(dict):
 def chunks(self,operation,name):
  assert operation=='get'
  yield from json.JSONEncoder().iterencode(dict.__getitem__(self,name))
 def __getitem__(self,name):
  if mode.startswith('file'):raise AssertionError('publication loaded a complete saved record')
  return super().__getitem__(name)
 def get(self,*args):raise AssertionError('confirmation loaded a complete saved record')
 def paths(self,name,field):yield from self[name][field]
 def __missing__(self,name):return [name,'metadata','',[],[],None]
records = Records({name:[name, 'metadata', '', [], [], None] for name in ('active','remove')})
if mode=='decline-paths':records['remove'][3:5]=[['/remove/one','/remove/two'],['/keep/manual']]
class RemovalPath(str):
 live=0
 def __new__(cls,value):
  obj=super().__new__(cls,value);cls.live+=1;return obj
 def __del__(self):RemovalPath.live-=1
def removal_paths():
 for index in range(1024):
  yield RemovalPath('/path/'+str(index))
  assert RemovalPath.live<=4,('publication retained new removal paths',RemovalPath.live)
def listing(dist):
 yield removal_paths()
 yield iter(())
namespace = {
 '_safe_removal_listing':listing,
 '_safe_package_publication': '/publication.json' if mode.startswith('file') or mode.startswith('new-file') else None,
 '_SafeNames':Names, '_SafeValues':Values, '_safe_package_noDeps':False, '_safe_package_constraints_json':'[]', '_safe_json':json, '_safe_resolve':resolve, '_safe_roots':Names(), '_safe_package_upgrade':False, '_safe_package_forceReinstall':False,
 '_safe_metadata':types.SimpleNamespace(distributions=distributions, distribution=distribution, PackageNotFoundError=Missing, MetadataPathFinder=types.SimpleNamespace(invalidate_caches=lambda:None)),
 '_safe_name':lambda value:value.lower(), '_SafeRequirement':lambda value:types.SimpleNamespace(name=value),
 '_safe_uninstall':None if mode in ('install','large','pin-failure','file','file-failure','new-file','new-file-large','new-file-write-failure') else {'packages':['missing' if mode == 'missing' else 'remove'], 'yes':not mode.startswith('decline')},
 '_safe_package_record':record, '_safe_preloaded':set(), '_safe_restored_names':Names(['remove']), '_safe_package_emit':emit, '_safe_package_line':line,
 '_safe_manager':types.SimpleNamespace(uninstall=uninstall), '_safe_snapshot_path':lambda name:None if mode.startswith('new-file') else '/installed/'+name if name in records or name.startswith('package-') else None, '_safe_record_by_name':records,
}
try:
 with patch('io.StringIO',side_effect=AssertionError('buffered inventory transport')), patch('builtins.open',return_value=writer):
  asyncio.run(eval(code, namespace))
except RuntimeError as error:
 if mode in ('file-failure','new-file-write-failure'):
  if mode=='new-file-write-failure':assert namespace['_safe_lists'].gi_frame is None
  assert str(error)=='write denied' and writer.closed
  assert not pins and not published
  sys.exit(0)
 if mode!='pin-failure':raise
 assert str(error)=='pin denied'
 assert pins==['active @ file:///active.whl']
 assert closed==[namespace['_safe_roots'],namespace['_safe_sources'],namespace['_safe_versions']]
 sys.exit(0)
assert mode!='pin-failure','pin failure was swallowed'
assert closed[0] is namespace['_safe_roots']
assert closed[-4:] == [namespace['_safe_sources'],namespace['_safe_versions'],namespace['_safe_managed'],namespace['_safe_restored_names']]
assert len(closed)==(7 if namespace['_safe_uninstall'] else 6 if mode in ('file','new-file','new-file-large') else 5)
expected = ['file:///active.whl', 'active==1']
# Origins keep the normalized package name in the saved direct requirement.
expected[0] = 'active @ ' + expected[0]
if mode=='large':
 expected[1:1]=['package-'+str(i)+' @ file:///package-'+str(i)+'.whl' for i in range(1024)]
 expected.extend(name+'==1' for name in sorted('package-'+str(i) for i in range(1024)))
if mode != 'remove': expected.append('remove==2')
if mode in ('file','new-file','new-file-large'):
 assert writer.closed
 assert not published and not pins
 publication=json.loads(''.join(writer.parts))
 assert publication['version']==3
 pins=publication['installed'];published=publication['records']
assert pins == expected
assert '_safe_installed_json' not in namespace
if mode.startswith('new-file'):
 for name in records:records[name]=[name,'Name: '+name+'\n'+('Requires-Dist: '+ '"\\\t\n😀' * 20000+'\n' if mode=='new-file-large' else ''),'file:///active.whl' if name=='active' else '',['/path/'+str(i) for i in range(1024)],[],None]
assert published == [dict.__getitem__(records,name) for name in ('active','remove') if name != 'remove' or mode != 'remove'] + ([records['package-'+str(i)] for i in range(1024)] if mode=='large' else [])
assert not any('Successfully' in text for _,text in output)
if namespace['_safe_uninstall']:
 asyncio.run(namespace['_safe_publish_uninstalled']())
 assert closed[-1] is namespace['_safe_removed']
assert [text for _,text in output if 'Successfully' in text] == (['  Successfully uninstalled remove-2\n'] if mode == 'remove' else [])
if mode == 'missing': assert output == [('stderr', 'WARNING: Skipping missing as it is not installed.\n')]
if mode.startswith('decline'):
 assert output[-1] == ('stdout', 'Proceed (Y/n)? ')
 assert [text for _,text in output][1:-1] == (['  Would remove:\n','    /remove/one\n','    /remove/two\n','  Would not remove (might be manually added):\n','    /keep/manual\n'] if mode=='decline-paths' else [])
assert peak <= 3
`],{input:JSON.stringify([await loadPythonPackageProgram(),mode]),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
