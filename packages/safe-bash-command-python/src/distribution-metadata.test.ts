import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

for(const adapted of [false,true])for(const mode of ['large','fallback','missing','malformed','permission','decode-error','close-error','custom','custom-instance','storage-error','legacy','long-line','custom-path','nested','delivery-status','header-storage-error','header-parse-error','header-init-error','parsed-header-storage-error','scope-lifetime','scope-error','repair-storage-error','interleaved-read','interleaved-append','sequential-io'])test('native distribution metadata stages text before parsing with bounded reads: '+mode+'; adapted='+adapted,()=>{
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import ast,io,json,pathlib,sys,email.parser,email.feedparser,importlib.metadata as metadata
from unittest.mock import patch
import tempfile
source,mode,adapted,fixture=json.load(sys.stdin)
if adapted:
 import types
 import linecache
 linecache.cache['<pinned metadata message>']=(len(fixture),None,fixture.splitlines(True),'<pinned metadata message>')
 native={"__package__":"importlib.metadata"}
 exec(compile(fixture,'<pinned metadata message>','exec'),native)
 native['_adapters']=types.SimpleNamespace(Message=native['Message'])
 metadata._adapters=native['_adapters']
 metadata.Distribution.metadata=property(native['metadata'])
tracking=False;opened=[];stores=[]
class Values:
 def __init__(self):
  self.values={};self.closed=False;stores.append(self)
 def put(self,key,value):
  if mode=='storage-error':raise OSError('storage denied')
  assert len(value)<=8192
  self.values[key]=value
 def get(self,key,default=None):return self.values.get(key,default)
 def __len__(self):return len(self.values)
 def close(self):self.closed=True
class File(io.StringIO):
 def __init__(self,text,path):super().__init__(text,newline=None);self.path=path;opened.append(self)
 def read(self,size=-1):
  if self.path.endswith('/METADATA') and (size<0 or self.tell()>=8192):
   if mode=='permission':raise PermissionError('read denied')
   if mode=='decode-error':raise UnicodeDecodeError('utf-8',b'\xff',0,1,'invalid start byte')
  if tracking:assert 0<size<=8192,('unbounded metadata text read',size)
  return super().read(size)
 def close(self):
  super().close()
  if mode=='close-error' and self.path.endswith('/METADATA'):raise PermissionError('close denied')
root=pathlib.Path('/fixture.dist-info')
files={str(root/'METADATA'):'Name: fixture\r\nVersion: 1\r\n'+''.join('Requires-Dist: package-'+str(i)+';\n        python_version >= "3"\n' for i in range(1024))+'\n'+'description 😀\r\n'*2048,str(root/'PKG-INFO'):'Name: fallback\nVersion: 2\n'}
if mode=='fallback':files[str(root/'METADATA')]=''
if mode=='missing':files={}
if mode=='legacy':files={str(root):'Name: legacy\nVersion: 3\n'}
if mode=='long-line':files[str(root/'METADATA')]='Name: fixture\nRequires-Dist: '+('long😀'*20000)+'\n'
if mode=='nested':files[str(root/'METADATA')]='Name: fixture\nContent-Type: multipart/mixed; boundary=part\n\n--part\n'+files[str(root/'METADATA')]+'\n--part--\n'
if mode=='delivery-status':files[str(root/'METADATA')]='Name: fixture\nContent-Type: message/delivery-status\n\nAction: delivered\nStatus: 2.0.0\n\nAction: delayed\nStatus: 4.0.0\n'
if mode=='malformed':files[str(root/'METADATA')]='Name: fixture\n continued\nBad Header\nbody\n'
def open_file(path,*args,**kwargs):
 if str(path) not in files:raise FileNotFoundError(str(path))
 return File(files[str(path)],str(path))
class Custom(metadata.PathDistribution):
 @property
 def metadata(self):return {'Name':'custom'}
class CustomPath:
 def joinpath(self,name):return self
 def read_text(self,**kwargs):return 'Name: custom-path\n'
 def open(self,**kwargs):raise AssertionError('custom path read_text bypassed')
dist=Custom(root) if mode=='custom' else metadata.PathDistribution(CustomPath() if mode=='custom-path' else root)
if mode=='custom-instance':dist.read_text=lambda name:'Name: instance\n'
from functools import cache
namespace={'_safe_metadata_scope':__import__('contextlib').contextmanager,'_safe_installation_root':'/caller','_safe_cache':cache,'_safe_metadata':metadata,'_SafeValues':Values}
tree=ast.parse(source)
selected=[node for node in tree.body if isinstance(node,(ast.FunctionDef,ast.ClassDef)) and node.name in ('_safe_metadata_adapter_code','_safe_distribution_metadata','_SafeMetadataText','_safe_read_metadata_text','_SafeMetadataLines','_SafeMetadataHeaders','_safe_metadata_header_code','_safe_parse_metadata')]
exec(compile(ast.Module(body=selected,type_ignores=[]),'<metadata>','exec'),namespace)
assert namespace['_safe_metadata_header_code']().co_firstlineno==email.feedparser.FeedParser._parsegen.__code__.co_firstlineno,'native parser traceback lines changed'
if adapted:
 codes=namespace['_safe_metadata_adapter_code']()
 assert [code.co_firstlineno for code in codes]==[metadata.Distribution.metadata.fget.__code__.co_firstlineno,metadata._adapters.Message._repair_headers.__code__.co_firstlineno]
def describe(value):
 if mode in ('interleaved-read','interleaved-append'):
  outer=iter(value._headers)
  first=next(outer)
  assert value['Version']=='1'
  if mode=='interleaved-append':value._headers.append(('X-Late','late 😀'))
  second=next(outer)
  inner=iter(value._headers)
  assert next(inner)==first
  remaining=list(outer)
  assert next(inner)==second
  assert [first,second]+remaining==list(value._headers)
 payload=value.get_payload() if hasattr(value,'get_payload') else None
 return ([(key,[describe(part) for part in val] if isinstance(val,list) else val) for key,val in value.items()],[describe(part) for part in payload] if isinstance(payload,list) else payload,[(type(error).__name__,str(error)) for error in getattr(value,'defects',[])])
native_parse=email.parser.Parser.parse
def parse(self,*args,**kwargs):
 assert all(file.closed for file in opened),'parser started before source closure'
 return native_parse(self,*args,**kwargs)
header_files=[]
seeks=0
class HeaderFile(io.StringIO):
 def seek(self,*args):
  global seeks
  seeks+=1
  return super().seek(*args)
 def write(self,value):
  assert len(value)<=98307
  if mode=='header-storage-error':raise OSError('header storage denied')
  if mode=='parsed-header-storage-error' and self is header_files[0]:raise OSError('parsed header storage denied')
  target=2 if adapted else 0
  if mode=='repair-storage-error' and len(header_files)>target and self is header_files[target]:raise OSError('repair storage denied')
  return super().write(value)
def header_file(**kwargs):
 assert kwargs['dir']=='/caller'
 if mode=='header-init-error':raise OSError('header initialization denied')
 value=HeaderFile();header_files.append(value);return value
native_close=email.feedparser.FeedParser.close
def close_parser(self):
 value=native_close(self)
 if tracking:assert not isinstance(value._headers,list) or not value._headers,'native parser accumulated parsed header pairs'
 return value
native_headers=email.feedparser.FeedParser._parse_headers
def parse_headers(self,lines):
 if tracking:
  assert not isinstance(lines,list) or not lines,'native parser accumulated all raw header lines'
  if mode=='header-parse-error':raise OSError('header parse denied')
 assert all(file.closed for file in opened),'parser started before source closure'
 return native_headers(self,lines)
with patch.object(tempfile,'TemporaryFile',header_file),patch.object(pathlib.Path,'open',open_file),patch.object(email.parser.Parser,'parse',parse),patch.object(email.feedparser.FeedParser,'_parse_headers',parse_headers),patch.object(email.feedparser.FeedParser,'close',close_parser):
 failure=None
 try:expected=describe(dist.metadata)
 except Exception as error:failure=(type(error),str(error))
 tracking=not mode.startswith('custom')
 try:
  with namespace['_safe_distribution_metadata'](dist) as value:
   if mode in ('large','folded','long-line'):assert not isinstance(value._headers,list),'final metadata header collection materialized'
   if mode in ('scope-lifetime','scope-error'):
    assert not value._headers.lines.file.closed,'metadata backing closed before consumption'
    iterator=iter(value._headers);assert next(iterator)==('Name','fixture')
    if mode=='scope-error':raise OSError('consumer stopped')
   actual=describe(value)
 except Exception as error:
  if mode in ('storage-error','header-storage-error','header-parse-error','header-init-error','parsed-header-storage-error','scope-error','repair-storage-error'):
   expected_error={'storage-error':'storage denied','header-storage-error':'header storage denied','header-parse-error':'header parse denied','header-init-error':'header initialization denied','parsed-header-storage-error':'parsed header storage denied','scope-error':'consumer stopped','repair-storage-error':'repair storage denied'}[mode]
   assert (type(error),str(error))==(OSError,expected_error)
  else:assert failure==(type(error),str(error)),(failure,type(error),str(error))
 else:
  assert failure is None
  assert actual==expected
  assert mode not in ('storage-error','header-storage-error','header-parse-error','header-init-error','parsed-header-storage-error','scope-error','repair-storage-error'),'caller storage was bypassed'
if mode=='sequential-io':assert seeks<200,('sequential metadata performs per-header seeks',seeks)
assert all(file.closed for file in opened+header_files)
assert all(store.closed for store in stores)
if mode in ('large','fallback','malformed'):assert stores
`],{input:JSON.stringify([readFileSync(new URL('./package-program.py',import.meta.url),'utf8'),mode,adapted,readFileSync(new URL('./fixtures/pinned-metadata-message.py',import.meta.url),'utf8')]),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
