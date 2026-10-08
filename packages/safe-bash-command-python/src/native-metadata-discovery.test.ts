import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

test('metadata discovery preserves pinned grouping without retaining all paths',()=>{
 const fixture=readFileSync(new URL('./fixtures/pinned-metadata-lookup.py',import.meta.url),'utf8');
 const program=readFileSync(new URL('./metadata-discovery.py',import.meta.url),'utf8');
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import builtins,contextlib,errno,gc,importlib.metadata as metadata,io,json,linecache,os,pathlib,sys,tempfile,types,weakref,zipfile
from unittest.mock import patch
fixture,program=json.load(sys.stdin)
fixture='from __future__ import annotations\n'+fixture
filename='<pinned metadata lookup>'
linecache.cache[filename]=(len(fixture),None,fixture.splitlines(True),filename)
namespace=dict(metadata.__dict__)
exec(compile(fixture,filename,'exec'),namespace)
original=namespace['Lookup']
Prepared=namespace['Prepared']
class Path(str):
 live=maximum=0
 def __new__(cls,value):
  obj=super().__new__(cls,value);cls.live+=1;cls.maximum=max(cls.maximum,cls.live);return obj
 def __del__(self):Path.live-=1
class Root:
 root='/packages'
 def __init__(self,names):self.names=names
 def children(self):return iter(self.names)
 def joinpath(self,child):return Path(self.root+'/'+child)
# Virtual backing storage: tests never create host files.
files={};directories={'/owned','/packages'};children_by_parent={};allocations=[];write_failure=False
class File(io.StringIO):
 def __init__(self,path,mode):
  self.path=path;self.mode=mode
  if write_failure and mode=='a' and path.endswith('/rows'):raise PermissionError('backing write denied')
  if mode=='r' and path not in files:raise FileNotFoundError(path)
  super().__init__(files.get(path,'') if mode in ('r','a') else '')
  if mode=='a':self.seek(0,2)
 def close(self):
  if not self.closed and self.mode!='r':
   files[self.path]=self.getvalue()
   children_by_parent.setdefault(os.path.dirname(self.path),set()).add(self.path)
  super().close()
def mkdir(path,exist_ok=False,**kwargs):
 path=str(path)
 while path and path not in directories:
  directories.add(path)
  parent=os.path.dirname(path);children_by_parent.setdefault(parent,set()).add(path);path=parent
def temporary(*,dir,prefix):
 assert dir=='/owned'
 path=dir+'/'+prefix+str(len(allocations));allocations.append(path);mkdir(path);return path
names=[];scan_failure=False
@contextlib.contextmanager
def scandir(path):
 if path in ['/packages','/packages.egg']:
  if scan_failure:raise PermissionError('scan denied')
  yield (types.SimpleNamespace(name=name) for name in names)
 else:
  assert path in directories,path
  children=tuple(children_by_parent.get(path,()))
  def entries():
   for key in children:
    if set(children)!=children_by_parent.get(path,set()):raise BlockingIOError('directory changed during enumeration')
    yield types.SimpleNamespace(path=key,is_dir=lambda follow_symlinks=False,key=key:key in directories)
  yield entries()
def unlink(path):
 if path not in files:raise FileNotFoundError(path)
 files.pop(path);children_by_parent[os.path.dirname(path)].remove(path)
def rmdir(path):
 if path not in directories:raise FileNotFoundError(path)
 if children_by_parent.get(path):raise OSError(errno.ENOTEMPTY,'directory not empty',path)
 directories.remove(path);children_by_parent[os.path.dirname(path)].remove(path);children_by_parent.pop(path,None)
patches=[patch.object(metadata,'Lookup',original,create=True),patch.object(metadata.MetadataPathFinder,'invalidate_caches',create=True),patch('builtins.open',side_effect=lambda path,mode='r',**kwargs:File(str(path),mode)),patch('os.makedirs',side_effect=mkdir),patch('os.path.isdir',side_effect=lambda path:str(path) in directories),patch('os.path.exists',side_effect=lambda path:str(path) in files or str(path) in directories),patch('tempfile.mkdtemp',side_effect=temporary),patch('os.scandir',side_effect=scandir),patch('os.unlink',side_effect=unlink),patch('os.rmdir',side_effect=rmdir)]
with contextlib.ExitStack() as stack:
 for item in patches:stack.enter_context(item)
 exec(program,{'_safe_installation_root':'/owned','_safe_runtime_mount':'/runtime'})
 for entries in [['A-1.dist-info','B-1.dist-info','A-2.dist-info'],['A_B-1.dist-info','a.b-2.egg-info','ignored'],['EGG-INFO','foo-1.dist-info']]:
  names[:]=entries
  root=Root(entries)
  for query in [None,'a','A.B','foo','absent','']:
   expected=[str(p) for p in original(root).search(Prepared(query))]
   actual=metadata.Lookup(root)
   assert [str(p) for p in actual.search(Prepared(query))]==expected,(entries,query,expected)
   del actual
  gc.collect()
 names[:]=['package_%05d-1.dist-info'%i for i in range(4096)]
 Path.maximum=0
 lookup=metadata.Lookup(Root(names))
 assert Path.maximum<=4,('metadata paths retained',Path.maximum)
 assert sum(1 for _ in lookup.search(Prepared(None)))==4096
 assert [str(p) for p in lookup.search(Prepared('package-00007'))]==['/packages/package_00007-1.dist-info']
 # A suspended iterator must keep its snapshot alive after cache eviction.
 iterator=lookup.search(Prepared(None));next(iterator);del lookup;gc.collect()
 assert sum(1 for _ in iterator)==4095
 del iterator;gc.collect()
 assert not files,('metadata scratch leaked',list(files)[:3])
 assert allocations,'caller backing was never used'
 # Legacy eggs, empty names, Unicode and normalized collisions follow the same
 # pinned initializer; caller directory mutation doesn't rewrite a snapshot.
 directories.add('/packages.egg');Root.root='/packages.egg'
 names[:]=['EGG-INFO','a.b-1.dist-info','A_B-2.egg-info','.dist-info','caf\u00e9-1.dist-info']
 lookup=metadata.Lookup(Root(names));names.append('later-1.dist-info')
 for query in [None,'packages','a-b','caf\u00e9','missing']:
  expected=[str(p) for p in original(Root(names[:-1])).search(Prepared(query))]
  assert [str(p) for p in lookup.search(Prepared(query))]==expected
 del lookup;gc.collect();assert not files
 # ZIP paths must retain archive semantics while group rows use caller storage.
 payload=io.BytesIO()
 zip_names=['zip_package_%04d-1.dist-info'%i for i in range(1024)]
 with zipfile.ZipFile(payload,'w') as writer:
  for name in zip_names:writer.writestr(name+'/METADATA','Name: '+name+'\n')
 archive=zipfile.Path(io.BytesIO(payload.getvalue())).root
 class ZipPath(zipfile.Path):
  live=maximum=0
  def __init__(self,*args,**kwargs):
   super().__init__(*args,**kwargs);ZipPath.live+=1;ZipPath.maximum=max(ZipPath.maximum,ZipPath.live)
  def __del__(self):ZipPath.live-=1
 class ZipRoot:
  root='/packages.zip'
  def children(self):return self.zip_children()
  def zip_children(self):return iter(zip_names)
  def joinpath(self,child):return ZipPath(archive,child+'/')
 zip_root=ZipRoot()
 for failed_scan in (False,True):
  ZipRoot.root='/packages' if failed_scan else '/packages.zip'
  scan_failure=failed_scan;ZipPath.maximum=0
  lookup=metadata.Lookup(zip_root)
  assert ZipPath.maximum<=4,('ZIP metadata paths retained',ZipPath.maximum)
  selected=list(lookup.search(Prepared('zip-package-0007')))
  assert len(selected)==1 and isinstance(selected[0],zipfile.Path)
  assert selected[0].joinpath('METADATA').read_text()=='Name: zip_package_0007-1.dist-info\n'
  iterator=lookup.search(Prepared(None));first=next(iterator)
  assert first.at==zip_names[0]+'/'
  del lookup,selected,first;gc.collect()
  assert sum(1 for _ in iterator)==1023
  del iterator;gc.collect();assert not files
  assert archive.read(zip_names[0]+'/METADATA').startswith(b'Name: '),'borrowed archive was closed'
 scan_failure=False;ZipRoot.root='/packages.zip';write_failure=True
 try:metadata.Lookup(zip_root)
 except PermissionError as error:assert str(error)=='backing write denied'
 else:raise AssertionError('ZIP scratch failure swallowed')
 gc.collect();assert not files
 write_failure=False;archive.close()
 # Native children suppress failed directory enumeration and then try ZIP.
 scan_failure=True
 lookup=metadata.Lookup(Root(names))
 assert list(lookup.search(Prepared(None)))==[]
 del lookup;gc.collect();assert not files
 scan_failure=False;write_failure=True
 try:metadata.Lookup(Root(names))
 except PermissionError as error:assert str(error)=='backing write denied'
 else:raise AssertionError('scratch failure swallowed')
 gc.collect();assert not files
 write_failure=False
 # Fixed runtime assets and non-directory/ZIP paths keep the native boundary.
 Root.root='/runtime/lib';before=len(allocations)
 lookup=metadata.Lookup(Root(names))
 assert [str(p) for p in lookup.search(Prepared(None))]==[str(p) for p in original(Root(names)).search(Prepared(None))]
 del lookup;gc.collect();assert len(allocations)==before

`],{input:JSON.stringify([fixture,program]),encoding:'utf8',timeout:15000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.stderr,'');
});
