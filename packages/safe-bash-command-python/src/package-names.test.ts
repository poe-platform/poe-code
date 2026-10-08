import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

test('resolved package names use caller storage with set semantics and bounded guest retention',()=>{
 const source=readFileSync(new URL('./package-program.py',import.meta.url),'utf8');
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import ast,asyncio,contextlib,errno,gc,io,json,os,sys,types
from collections.abc import MutableSet
from pip._vendor.packaging.requirements import Requirement as NativeRequirement
from unittest.mock import patch
class Name(str):
 live=0
 def __new__(cls,value):
  obj=super().__new__(cls,value);cls.live+=1;return obj
 def __del__(self):Name.live-=1
class Source(str):
 live=0
 def __new__(cls,value):
  obj=super().__new__(cls,value);cls.live+=1;return obj
 def __del__(self):Source.live-=1
class Requirement(NativeRequirement):
 live=0
 def __init__(self,name):
  super().__init__(name);Requirement.live+=1
 def __del__(self):Requirement.live-=1
 def __str__(self):return Source(super().__str__())
files={};directories={'/owned'};children={};serial=0;denied=False
class File(io.StringIO):
 def __init__(self,path,mode):
  if denied:raise PermissionError('denied')
  if mode=='r' and path not in files:raise FileNotFoundError(path)
  self.path,self.mode=path,mode
  super().__init__(files.get(path,'') if mode in ('r','a') else '')
  if mode=='a':self.seek(0,2)
 def close(self):
  if not self.closed and self.mode!='r':
   files[self.path]=self.getvalue();children.setdefault(os.path.dirname(self.path),set()).add(self.path)
  super().close()
 def read(self,size=-1):
  if self.path.endswith('/entry'):assert 0<=size<=5,('unbounded ordinal read',size)
  return super().read(size)
def mkdir(path,exist_ok=False):
 while path not in directories:
  directories.add(path);parent=os.path.dirname(path);children.setdefault(parent,set()).add(path);path=parent
def temporary(*,dir,prefix):
 global serial
 assert dir=='/owned' or dir.startswith('/owned/');serial+=1;path=dir+'/'+prefix+str(serial);mkdir(path);return path
def unlink(path):
 if path not in files:raise FileNotFoundError(path)
 del files[path];children[os.path.dirname(path)].remove(path)
def rmdir(path):
 if path not in directories:raise FileNotFoundError(path)
 if children.get(path):raise OSError(errno.ENOTEMPTY,'not empty')
 directories.remove(path);children[os.path.dirname(path)].remove(path);children.pop(path,None)
pm=types.ModuleType('micropip.package_manager');pm.Transaction=type('Transaction',(),{})
micropip=types.ModuleType('micropip');micropip.package_manager=pm
sys.modules['micropip']=micropip;sys.modules['micropip.package_manager']=pm
evolving=False;rounds=0
async def install(requirements,**kwargs):
 global rounds
 if evolving:
  gc.collect();assert Source.live<=len(requirements)+8,('past resolution strings retained',Source.live,len(requirements))
  if requirements and requirements[0].startswith('leaf-'):rounds+=1
 gc.collect();assert Requirement.live<=8,('parsed roots retained during install',Requirement.live)
 assert Name.live<=8,('requested/extras names retained during install',Name.live)
def distributions():
 if evolving:
  yield types.SimpleNamespace(metadata={'Name':'root'},version='1',requires=['leaf-'+str(rounds)+'-'+str(i)+'>=1' for i in range(64)] if rounds<3 else [])
  return
 for i in range(1024):
  yield types.SimpleNamespace(metadata={'Name':'package-'+str(i)},version='1',requires=[])
  assert Name.live<=8,('version names retained during scan',Name.live)
namespace={'_SafeRequirement':Requirement,'_safe_name':Name,'_safe_preloaded':set(),'_safe_metadata':types.SimpleNamespace(distributions=distributions),'_safe_manager':types.SimpleNamespace(install=install),'_safe_validate':lambda roots:None,'_safe_package_pre':False,'_SafeMutableSet':MutableSet,'_safe_installation_root':'/owned'}
tree=ast.parse(json.load(sys.stdin))
selected=[n for n in tree.body if isinstance(n,(ast.ClassDef,ast.AsyncFunctionDef)) and n.name in ('_SafeNames','_SafeValues','_SafeRequirements','_SafeResolutions','_safe_parse_sources','_safe_resolve')]
exec(compile(ast.Module(body=selected,type_ignores=[]),'<package names>','exec'),namespace)
with contextlib.ExitStack() as stack:
 for target,replacement in [('builtins.open',lambda path,mode='r',**kwargs:File(path,mode)),('tempfile.mkdtemp',temporary),('os.makedirs',mkdir),('os.unlink',unlink),('os.rmdir',rmdir)]:stack.enter_context(patch(target,replacement))
 roots=asyncio.run(namespace['_safe_parse_sources'](('package-'+str(i) for i in range(1024))))
 gc.collect();assert Requirement.live<=4,('parsed source roots retained',Requirement.live)
 managed=asyncio.run(namespace['_safe_resolve'](roots))
 roots.close()
 gc.collect()
 assert len(managed)==1024
 assert Name.live<=4,('resolved names retained in guest',Name.live)
 assert set(managed)=={'package-'+str(i) for i in range(1024)}
 native_sorted=sorted
 def bounded_sorted(values):
  assert len(values)<=64,('whole inventory sort',len(values))
  return native_sorted(values)
 before_files=set(files);before_directories=set(directories)
 with patch('builtins.sorted',bounded_sorted):
  assert list(managed.ordered())==native_sorted(managed)
  assert list(managed.ordered(key=len))==native_sorted(managed,key=len)
 assert set(files)==before_files and directories==before_directories
 ordered=managed.ordered();assert next(ordered)=='package-0';ordered.close()
 assert set(files)==before_files and directories==before_directories
 managed.add('package-4');assert len(managed)==1024
 managed.discard('package-4');managed.discard('absent');assert len(managed)==1023 and 'package-4' not in managed
 managed.add('package-4');assert len(managed)==1024 and list(managed).count('package-4')==1
 for name in ['caf\u00e9','x'*300,'../outside','a/b','A','a','']:
  managed.add(name);assert name in managed
 assert all(p.startswith('/owned/') for p in files)
 denied=True
 try:'package-4' in managed
 except PermissionError:pass
 else:raise AssertionError('read error hidden as absent name')
 denied=False
 path=managed.path('package-4');original=files[path];files[path]='9'*1024
 try:'package-4' in managed
 except ValueError:pass
 else:raise AssertionError('oversized ordinal admitted')
 files[path]=original
 managed.close();assert not files and directories=={'/owned'},(len(files),directories)
 for size in (0,1,65,129):
  names=namespace['_SafeNames'](str(i) for i in range(size))
  with patch('builtins.sorted',bounded_sorted):assert list(names.ordered())==native_sorted(names)
  names.close()
 values=namespace['_SafeValues']()
 values.put('extras',['feature','other']);values.put('version','1');values.put('version','2');values.put('null',None)
 assert len(values)==3 and values.get('version')=='2' and values.get('extras')==['feature','other']
 assert values.get('absent','default')=='default' and values.get('null','default') is None
 files[values.path('version','value')]='{'
 try:values.get('version')
 except ValueError:pass
 else:raise AssertionError('corrupt graph record admitted')
 values.close()
 without=asyncio.run(namespace['_safe_resolve']([Requirement('only')],no_deps=True))
 assert set(without)=={'only'};without.close()
 assert not files and directories=={'/owned'},(len(files),directories)
 evolving=True
 resolved=asyncio.run(namespace['_safe_resolve']([Requirement('root')]))
 assert rounds==3 and len(resolved)==193
 resolved.close();gc.collect();assert Source.live==0
 assert not files and directories=={'/owned'},(len(files),directories)
 # Digest collisions must still compare exact records, including differing
 # counts and escaped text. No past input strings may remain in guest state.
 history=namespace['_SafeResolutions']()
 class Digest:
  def update(self,value):pass
  def hexdigest(self):return 'collision'
 with patch('hashlib.sha256',Digest):
  assert not history.repeated([])
  assert not history.repeated([Source('first>=1')])
  assert not history.repeated([Source('first>=1'),Source('second>=2')])
  assert not history.repeated([Source('quote"\\path\né')])
  assert history.repeated([Source('first>=1')])
  assert history.repeated([Source('first>=1'),Source('second>=2')])
  assert history.repeated([Source('quote"\\path\né')])
  assert history.repeated([])
  gc.collect();assert Source.live==0,('history retained input strings',Source.live)
  path=history.path('collision','value');original=files[path]
  for corrupt in ['9'*1024, '1\n'+json.dumps('x'*1024)+'\n', '1\nnull\n', '1\n']:
   files[path]=corrupt
   try:history.repeated([Source('first>=1')])
   except ValueError:pass
   else:raise AssertionError('corrupt resolution history admitted')
  files[path]=original
 history.close()
 assert not files and directories=={'/owned'},(len(files),directories)
 # Run the real uninstall block against the same virtual backing.
 start=next(i for i,n in enumerate(tree.body) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='_safe_removed' for t in n.targets))
 end=next(i for i,n in enumerate(tree.body) if i>start and isinstance(n,ast.Expr) and isinstance(n.value,ast.Call) and isinstance(n.value.func,ast.Attribute) and isinstance(n.value.func.value,ast.Name) and n.value.func.value.id=='_safe_managed')
 uninstall_code=compile(ast.Module(body=tree.body[start:end],type_ignores=[]),'<uninstall state>','exec',flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
 class Version(str):
  live=0
  def __new__(cls,value):
   obj=super().__new__(cls,value);cls.live+=1;return obj
  def __del__(self):Version.live-=1
  def __radd__(self,other):return Source(str(other)+str(self))
 removed=[];emitted=[]
 class Missing(Exception):pass
 def installed():
  for i in range(1024):
   yield types.SimpleNamespace(metadata={'Name':'package-'+str(i)},version=Version('1'))
   assert Name.live<=8,('uninstall target names retained',Name.live)
   assert Version.live<=8,('uninstall versions retained',Version.live)
 def distribution(name):
  if name in removed:raise Missing(name)
  return types.SimpleNamespace(version=Version('1'))
 def uninstall(names):
  assert Source.live<=8,('uninstall removed names retained',Source.live)
  removed.extend(str(name) for name in names)
 async def emit(channel,value):emitted.append((channel,str(value)))
 restored=namespace['_SafeNames']('package-'+str(i) for i in range(1024))
 namespace.update(_safe_json=json,_safe_uninstall={'packages':['package-'+str(i) for i in range(1024)]+['package-0','absent'], 'yes':True},_safe_name=Name,_safe_preloaded=set(),_safe_managed=set(),_safe_restored_names=restored,_safe_package_emit=emit,_safe_manager=types.SimpleNamespace(uninstall=uninstall),_safe_metadata=types.SimpleNamespace(distributions=installed,distribution=distribution,PackageNotFoundError=Missing,MetadataPathFinder=types.SimpleNamespace(invalidate_caches=lambda:None)))
 asyncio.run(eval(uninstall_code,namespace))
 assert removed==['package-'+str(i) for i in range(1024)]
 assert not any('Successfully' in text for _,text in emitted),'success preceded manifest publication'
 asyncio.run(namespace['_safe_publish_uninstalled']())
 assert [text for _,text in emitted if 'Successfully' in text]==['  Successfully uninstalled package-'+str(i)+'-1\n' for i in range(1024)]
 assert emitted.count(('stderr','WARNING: Skipping absent as it is not installed.\n'))==1
 restored.close()
 assert not files and directories=={'/owned'},(len(files),directories)
 for failure in (PermissionError('output denied'),asyncio.CancelledError()):
  pending=namespace['_SafeValues']();pending.put('0','package-0-1');pending.put('1','package-1-1')
  calls=[]
  async def fail_emit(channel,text):
   calls.append(text)
   raise failure
  namespace.update(_safe_removed=pending,_safe_package_emit=fail_emit)
  async def check_failure():
   try:await namespace['_safe_publish_uninstalled']()
   except BaseException as error:assert error is failure
   else:raise AssertionError('publication output failure swallowed')
  asyncio.run(check_failure())
  assert calls==['  Successfully uninstalled package-0-1\n']
  assert not files and directories=={'/owned'},(len(files),directories)
`],{input:JSON.stringify(source),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
