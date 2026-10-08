import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

test('metadata discovery preserves pinned grouping without retaining all paths',()=>{
 const fixture=readFileSync(new URL('./fixtures/pinned-metadata-lookup.py',import.meta.url),'utf8');
 const program=readFileSync(new URL('./metadata-discovery.py',import.meta.url),'utf8');
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import builtins,contextlib,errno,gc,importlib.metadata as metadata,io,json,linecache,os,pathlib,sys,tempfile,types,warnings,weakref,zipfile
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
files={};directories={'/owned','/packages'};children_by_parent={};allocations=[];write_failure=False;child_write_failure=False;member_write_failure=False;sort_write_failure=False;enumeration_write_failure=False
class File(io.StringIO):
 def __init__(self,path,mode):
  self.path=path;self.mode=mode
  if write_failure and mode=='a' and path.endswith('/rows'):raise PermissionError('backing write denied')
  if child_write_failure and mode=='w' and '/2/' in path:raise PermissionError('child backing denied')
  if member_write_failure and mode=='w' and '/3/' in path:raise PermissionError('member backing denied')
  if sort_write_failure and mode=='w' and '/.zip-sort-' in path:raise PermissionError('sort backing denied')
  if enumeration_write_failure and mode=='w' and '/0/' in path:raise PermissionError('enumeration backing denied')
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
 assert dir in directories
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
  for name in zip_names:
   info=zipfile.ZipInfo(name+'/METADATA');info.comment=b'x'*64
   writer.writestr(info,'Name: '+name+'\n')
  for name in ['plain','plain/nested','implicit/nested/file','explicit/','/absolute/file','double//file']:
   writer.writestr(name,'data')
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
 # Native ZIP discovery deduplicates top-level children before grouping. Its
 # dictionary must not retain a second archive-sized collection of names.
 archive=zipfile.Path(io.BytesIO(payload.getvalue())).root
 class Child(str):
  live=maximum=0
  def __new__(cls,value):
   obj=super().__new__(cls,value);cls.live+=1;cls.maximum=max(cls.maximum,cls.live);return obj
  def __del__(self):Child.live-=1
 class Filename(str):
  def split(self,*args):
   parts=super().split(*args);parts[0]=Child(parts[0]);return parts
 NativeZipPath=zipfile.Path
 queries=['plain','implicit','implicit/nested','explicit','/absolute','double','double/','absent']
 expected_resolution={name:archive.resolve_dir(name) for name in queries}
 # Use a fresh archive: the native oracle intentionally populated its caches.
 archive.close();archive=NativeZipPath(io.BytesIO(payload.getvalue())).root
 class NativePath(NativeZipPath):
  def __init__(self,root,at=''):
   super().__init__(archive if root=='/packages.zip' else root,at)
 for entry in archive.filelist:entry.filename=Filename(entry.filename)
 with patch.object(zipfile,'Path',NativePath),patch.object(archive,'namelist',side_effect=AssertionError('eager ZIP filename cache')):
  fast=metadata.FastPath('/packages.zip')
  lookup=metadata.Lookup(fast)
  assert Child.maximum<=4,('ZIP child names retained',Child.maximum)
  assert [p.at.rstrip('/') for p in lookup.search(Prepared(None))]==zip_names
  assert {name:archive.resolve_dir(name) for name in queries}==expected_resolution
  assert not any(name.endswith('__names') or name.endswith('__lookup') for name in vars(archive))
  selected=next(lookup.search(Prepared('zip-package-0007')))
  del lookup,fast;gc.collect()
  # Returned ZIP paths can outlive the lookup; membership backing lives as long
  # as the archive that uses it, including after cache eviction.
  assert selected.joinpath('METADATA').read_text()=='Name: zip_package_0007-1.dist-info\n'
  del selected
 archive.close();del archive;gc.collect();assert not files
 archive=NativeZipPath(io.BytesIO(payload.getvalue())).root
 with patch.object(zipfile,'Path',NativePath):
  child_write_failure=True
  try:metadata.Lookup(metadata.FastPath('/packages.zip'))
  except PermissionError as error:assert str(error)=='child backing denied'
  else:raise AssertionError('child scratch failure swallowed')
  gc.collect();assert not files
  child_write_failure=False
  member_write_failure=True
  try:metadata.Lookup(metadata.FastPath('/packages.zip'))
  except PermissionError as error:assert str(error)=='member backing denied'
  else:raise AssertionError('member scratch failure swallowed')
  gc.collect();assert not files
  member_write_failure=False
 archive.close();del archive;gc.collect();assert not files
 # Opening the real archive must not copy its complete central directory.
 class Comment(bytes):
  live=maximum=0
  def __new__(cls,value):
   obj=super().__new__(cls,value);cls.live+=1;cls.maximum=max(cls.maximum,cls.live);return obj
  def __del__(self):Comment.live-=1
 class Source(io.BytesIO):
  maximum=0
  failure=False
  def read(self,size=-1):
   if Source.failure:raise OSError('ZIP source read denied')
   value=super().read(size);Source.maximum=max(Source.maximum,len(value));return Comment(value) if size==64 else value
 source_bytes=payload.getvalue()
 class ReadingPath(NativeZipPath):
  def __init__(self,root,at=''):
   super().__init__(Source(source_bytes) if root=='/packages.zip' else root,at)
 original_parser=zipfile.ZipFile._RealGetContents
 with patch.object(zipfile,'Path',ReadingPath):
  fast=metadata.FastPath('/packages.zip');lookup=metadata.Lookup(fast)
  assert [p.at.rstrip('/') for p in lookup.search(Prepared(None))]==zip_names
  assert Source.maximum<=65558,('whole ZIP directory read',Source.maximum)
  assert Comment.maximum<=4,('ZIP entry records retained',Comment.maximum)
  assert zipfile.ZipFile._RealGetContents is original_parser,'ZIP parser patch leaked'
  Entries=type(lookup._safe_store.archive.filelist);Store=type(lookup._safe_store)
  assert lookup._safe_store.archive.read(zip_names[7]+'/METADATA')==b'Name: zip_package_0007-1.dist-info\n'
  with zipfile.ZipFile(io.BytesIO(source_bytes)) as reference:
   reference_path=NativeZipPath(reference)
   expected_children={at:[child.at for child in NativeZipPath(reference_path.root,at).iterdir()] for at in ['', 'implicit/', 'plain/', 'explicit/', '/absolute/', 'double/']}
  backed_archive=lookup._safe_store.archive
  with patch.object(backed_archive,'namelist',side_effect=AssertionError('eager ZIP Path enumeration')):
   for at,expected in expected_children.items():
    assert [child.at for child in NativeZipPath(backed_archive,at).iterdir()]==expected
   before=set(files)
   cursor=NativeZipPath(backed_archive).iterdir()
   for child in cursor:
    if set(files)!=before:break
   else:raise AssertionError('implied ZIP directory enumeration never used backing')
   del cursor,child;gc.collect();assert set(files)==before
   enumeration_write_failure=True
   try:list(NativeZipPath(backed_archive).iterdir())
   except PermissionError as error:assert str(error)=='enumeration backing denied'
   else:raise AssertionError('enumeration backing failure swallowed')
   enumeration_write_failure=False
   gc.collect();assert set(files)==before
   try:NativeZipPath(backed_archive,'plain').iterdir()
   except ValueError as error:assert str(error)=="Can't listdir a file"
   else:raise AssertionError('file enumeration did not fail eagerly')
  del backed_archive
  del lookup,fast;gc.collect();assert not files
  for source_bytes in [b'',payload.getvalue()[:-22],payload.getvalue().replace(b'PK\x01\x02',b'XX\x01\x02',1)]:
   expected=[p.at for p in original(metadata.FastPath('/packages.zip')).search(Prepared(None))]
   fast=metadata.FastPath('/packages.zip');lookup=metadata.Lookup(fast)
   assert [p.at for p in lookup.search(Prepared(None))]==expected
   assert zipfile.ZipFile._RealGetContents is original_parser,'rejected ZIP leaked parser patch'
   del lookup,fast;gc.collect();assert not files
  source_bytes=payload.getvalue();Source.failure=True
  fast=metadata.FastPath('/packages.zip');lookup=metadata.Lookup(fast)
  assert list(lookup.search(Prepared(None)))==[]
  assert zipfile.ZipFile._RealGetContents is original_parser,'failed ZIP read leaked parser patch'
  del lookup,fast;gc.collect();assert not files
  Source.failure=False
  child_write_failure=True
  try:metadata.Lookup(metadata.FastPath('/packages.zip'))
  except PermissionError as error:assert str(error)=='child backing denied'
  else:raise AssertionError('entry backing failure swallowed')
  child_write_failure=False
  gc.collect();assert not files
  duplicates=io.BytesIO()
  with warnings.catch_warnings():
   warnings.simplefilter('ignore',UserWarning)
   with zipfile.ZipFile(duplicates,'w') as writer:
    writer.writestr('duplicate-1.dist-info/METADATA','first')
    writer.writestr('duplicate-1.dist-info/METADATA','last')
  source_bytes=duplicates.getvalue()
  def fields(entry):return [(name,getattr(entry,name)) for name in zipfile.ZipInfo.__slots__ if hasattr(entry,name)]
  with zipfile.ZipFile(io.BytesIO(source_bytes)) as reference:
   expected_entries=[fields(entry) for entry in reference.filelist]
   expected_content=reference.read('duplicate-1.dist-info/METADATA')
  fast=metadata.FastPath('/packages.zip');lookup=metadata.Lookup(fast)
  assert [fields(entry) for entry in lookup._safe_store.archive.filelist]==expected_entries
  assert lookup._safe_store.archive.read('duplicate-1.dist-info/METADATA')==expected_content==b'last'
  assert [child.at for child in NativeZipPath(lookup._safe_store.archive,'duplicate-1.dist-info/').iterdir()]==['duplicate-1.dist-info/METADATA']*2
  del lookup,fast;gc.collect();assert not files
 # Python 3.9 has no end-offset slot. Exercise the actual bounded sorter with
 # that newer native slot supplied, comparing reversed stable native ordering.
 NativeInfo=zipfile.ZipInfo
 class EndInfo(NativeInfo):
  __slots__=NativeInfo.__slots__+(() if '_end_offset' in NativeInfo.__slots__ else ('_end_offset',))
 native_sorted=sorted
 def bounded_sorted(values,*args,**kwargs):
  values=list(values);assert len(values)<=64,('unbounded ZIP sort',len(values))
  return native_sorted(values,*args,**kwargs)
 with patch.object(zipfile,'ZipInfo',EndInfo),patch('builtins.sorted',side_effect=bounded_sorted):
  for count in [0,1,64,65,129]:
   store=Store();entries=Entries(store)
   offsets=[(i*37)%53 for i in range(count)]
   for i,offset in enumerate(offsets):
    entry=EndInfo('member-'+str(i));entry.header_offset=offset;entries.append(entry)
   expected=[None]*count;end=1000
   for i in reversed(native_sorted(range(count),key=lambda i:offsets[i])):
    expected[i]=end;end=offsets[i]
   entries.seal(1000)
   assert [entry._end_offset for entry in entries]==expected
   assert [entry.filename for entry in entries]==['member-'+str(i) for i in range(count)]
   sort_write_failure=True
   if count:
    try:entries.seal(1000)
    except Exception as error:assert isinstance(error.__cause__,PermissionError)
    else:raise AssertionError('sort backing failure swallowed')
   sort_write_failure=False
   store.cleanup();del entries,store;gc.collect();assert not files
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
