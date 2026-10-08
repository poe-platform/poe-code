import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

for(const mode of ['large','lines','sources','invalid','early','custom','metadata-large','scan-error','permission','decode-error','custom-instance','missing','empty-sources'])test('distribution files preserve native parsing with caller-backed collections: '+mode,()=>{
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import ast,io,json,os,pathlib,posixpath,sys,types,importlib.metadata as metadata
from unittest.mock import patch
source,mode=json.load(sys.stdin)
tracking=False;opened=[];stores=[]
class Names:
 def __init__(self):self.values={};self.closed=False;stores.append(self)
 def add(self,name):self.values[str(name)]=None
 def __iter__(self):return iter(self.values)
 def __len__(self):return len(self.values)
 def close(self):self.closed=True
class Values(Names):
 def put(self,key,value):self.values[str(key)]=str(value)
 def get(self,key):return self.values[key]
class File(io.StringIO):
 def __init__(self,text,path):super().__init__(text);self.path=path;opened.append(self)
 def read(self,size=-1):
  if self.path.endswith('/RECORD') and (size<0 or self.tell()>=8192):
   if mode=='permission':raise PermissionError('read denied')
   if mode=='decode-error':raise UnicodeDecodeError('utf-8',b'\xff',0,1,'invalid start byte')
  if tracking:assert 0<size<=8192,('unbounded metadata read',size)
  return super().read(size)
root=pathlib.Path('/site');info=root/'fixture.dist-info'
lines=['file-'+str(i)+',,1' for i in range(1024)]
if mode=='lines':lines=['"comma,name",sha256=abc,2','"multi\nline",,3','unicode-é,,4','a\u2028b,,5']
if mode=='invalid':lines=['first,,1','bad,invalid,1']
files={str(info/'RECORD'):'\n'.join(lines)+'\n',str(info/'METADATA'):'Name: fixture\n'}
if mode=='permission':files[str(info/'SOURCES.txt')]='setup.py\n'
if mode in ('missing','empty-sources'):files.pop(str(info/'RECORD'))
if mode=='empty-sources':files[str(info/'SOURCES.txt')]=''
if mode=='sources':files[str(info/'RECORD')]='';files[str(info/'SOURCES.txt')]='setup.py\n"quoted"\n'
def open_file(path,*args,**kwargs):
 if str(path) not in files:raise FileNotFoundError(str(path))
 return File(files[str(path)],str(path))
metadata_names=['extra-'+str(i) for i in range(1024)] if mode=='metadata-large' else ['RECORD','METADATA']
def glob(path,pattern):
 assert not tracking,'metadata glob materialized directory entries'
 return (path/name for name in ([] if mode=='scan-error' else metadata_names))
class Scan:
 def __init__(self,path):self.names=iter(metadata_names);self.closed=False;self.count=0
 def __iter__(self):return self
 def __next__(self):
  if mode=='scan-error' and self.count==1:raise OSError('scan interrupted')
  self.count+=1
  return types.SimpleNamespace(name=next(self.names))
 def close(self):self.closed=True
 def __enter__(self):return self
 def __exit__(self,*args):self.close()
def original(dist):
 base=dist._path.parent
 result=set()
 for file in dist.files or []:result.add((base/file).resolve())
 result.update(dist._path.glob('*'))
 return result
utils=types.SimpleNamespace(get_root=lambda dist:dist._path.parent,get_dist_info=lambda dist:dist._path,get_files_in_distribution=original)
sys.modules['micropip._utils']=utils
class Custom(metadata.PathDistribution):
 @property
 def files(self):return ['custom']
dist=Custom(info) if mode=='custom' else metadata.PathDistribution(info)
if mode=='custom-instance':dist.read_text=lambda filename:'instance,,1' if filename=='RECORD' else None
namespace={'_safe_metadata':metadata,'_SafeNames':Names,'_SafeValues':Values}
tree=ast.parse(source);selected=[n for n in tree.body if isinstance(n,(ast.ClassDef,ast.FunctionDef)) and n.name in ('_safe_distribution_files','_safe_metadata_files','_SafeMetadataText','_safe_read_metadata_text')]
exec(compile(ast.Module(body=selected,type_ignores=[]),'<distribution files>','exec'),namespace)
NativePath=metadata.PackagePath
class TrackedPath(NativePath):
 live=0
 def __new__(cls,*args):
  value=super().__new__(cls,*args);cls.live+=1
  assert cls.live<=8,('retained native metadata paths',cls.live)
  return value
 def __del__(self):TrackedPath.live-=1
with patch.object(pathlib.Path,'open',open_file),patch.object(pathlib.Path,'glob',glob),patch.object(pathlib.Path,'resolve',lambda path:pathlib.Path(posixpath.normpath(str(path)))),patch.object(pathlib.Path,'exists',return_value=True),patch('os.scandir',Scan):
 expected_error=None
 try:expected=sorted(str(path) for path in original(dist))
 except Exception as error:expected_error=(type(error),str(error))
 tracking=not mode.startswith('custom')
 with patch.object(metadata,'PackagePath',TrackedPath):
  output=namespace['_safe_distribution_files'](dist)
  try:
   if mode=='early':next(output)
   else:actual=sorted(str(path) for path in output)
  except Exception as error:assert expected_error==(type(error),str(error)),(expected_error,type(error),str(error))
  else:
   assert expected_error is None
   if mode!='early':assert actual==expected
  finally:output.close()
assert all(file.closed for file in opened)
if not mode.startswith('custom'):assert stores and all(store.closed for store in stores)
`],{input:JSON.stringify([readFileSync(new URL('./package-program.py',import.meta.url),'utf8'),mode]),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
