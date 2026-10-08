import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

for(const mode of ['large','missing-version','duplicate','folded','decode-error','custom-version','custom-read','storage-error'])test('native distribution version preserves semantics with bounded metadata reads: '+mode,()=>{
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import ast,io,json,pathlib,sys,warnings,importlib.metadata as metadata
from unittest.mock import patch
source,mode=json.load(sys.stdin)
tracking=False;opened=[];stores=[]
class Values:
 def __init__(self):self.values={};self.closed=False;stores.append(self)
 def put(self,key,value):
  assert len(value)<=8192
  if mode=='storage-error':raise OSError('storage denied')
  self.values[key]=value
 def get(self,key,default=None):return self.values.get(key,default)
 def __len__(self):return len(self.values)
 def close(self):self.closed=True
class File(io.StringIO):
 def read(self,size=-1):
  if tracking:assert 0<size<=8192,('unbounded version metadata read',size)
  if mode=='decode-error' and (size<0 or self.tell()>=8192):raise UnicodeDecodeError('utf-8',b'\xff',0,1,'invalid start byte')
  return super().read(size)
text='Name: fixture\nVersion: 1\n'
if mode=='missing-version':text='Name: fixture\n'
if mode=='duplicate':text+='Version: 2\n'
if mode=='folded':text='Name: fixture\nVersion: 1\n .2\n'
text+='\n'+'description 😀\n'*10000
def open_file(path,*args,**kwargs):
 if path.name!='METADATA':raise FileNotFoundError(str(path))
 value=File(text);opened.append(value);return value
class Custom(metadata.PathDistribution):
 @property
 def version(self):return 'custom'
dist=(Custom if mode=='custom-version' else metadata.PathDistribution)(pathlib.Path('/fixture.dist-info'))
if mode=='custom-read':dist.read_text=lambda name:'Version: instance\n'
namespace={'_safe_metadata':metadata,'_SafeValues':Values}
tree=ast.parse(source)
selected=[node for node in tree.body if isinstance(node,(ast.FunctionDef,ast.ClassDef)) and node.name in ('_safe_distribution_version','_safe_distribution_metadata','_SafeMetadataText','_safe_read_metadata_text')]
exec(compile(ast.Module(body=selected,type_ignores=[]),'<version>','exec'),namespace)
def capture(read):
 with warnings.catch_warnings(record=True) as messages:
  warnings.simplefilter('always')
  try:result=('value',read())
  except Exception as error:result=('error',type(error),str(error))
  return result,[(message.category,str(message.message)) for message in messages]
with patch.object(pathlib.Path,'open',open_file):
 expected=capture(lambda:dist.version)
 tracking=True
 actual=capture(lambda:namespace.get('_safe_distribution_version',lambda value:value.version)(dist))
 if mode=='storage-error':assert actual[0]==('error',OSError,'storage denied'),actual
 else:assert actual==expected,(actual,expected)
assert all(value.closed for value in opened+stores)
if mode in ('large','missing-version','duplicate','folded'):assert stores
`],{input:JSON.stringify([readFileSync(new URL('./package-program.py',import.meta.url),'utf8'),mode]),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
