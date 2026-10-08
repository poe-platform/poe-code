import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

for(const mode of ['large','nested','open-error','read-error','stat-error','early','storage-error','symlink-change'])test('removal discovery matches native walk with caller-backed entries: '+mode,()=>{
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import ast,json,os,sys,types
from unittest.mock import patch
source,mode=json.load(sys.stdin)
tracking=False;handles=0;peak=0;stores=[];changed=False
class Name(str):
 live=0
 def __new__(cls,value):
  obj=super().__new__(cls,value);cls.live+=1;return obj
 def __del__(self):Name.live-=1
class Names:
 def __init__(self):self.values={};self.closed=False;stores.append(self)
 def add(self,name):
  if tracking and mode=='storage-error':raise PermissionError('storage denied')
  self.values[str(name)]=None
 def __iter__(self):
  for value in self.values:yield Name(value) if tracking else value
 def close(self):self.closed=True
class Values(Names):
 def put(self,key,value):self.values[key]=str(value)
 def get(self,key):return self.values[key]
 def __len__(self):return len(self.values)
class Entry:
 def __init__(self,name,directory=False):self.value=name;self.directory=directory
 @property
 def name(self):return Name(self.value) if tracking else self.value
 def is_dir(self):
  if mode=='stat-error' and self.value=='bad':raise PermissionError('stat denied')
  return self.directory
class Scan:
 def __init__(self,path):
  global handles,peak,changed
  if path=='/root/sub':changed=True
  if mode=='open-error' and path=='/root/sub':raise PermissionError('scan denied')
  self.path=path;self.index=0;self.closed=False;handles+=1;peak=max(peak,handles)
 def __enter__(self):return self
 def __exit__(self,*args):
  global handles
  self.closed=True;handles-=1
 def __iter__(self):return self
 def __next__(self):
  if tracking:assert Name.live<=8,('retained scan names',Name.live)
  if mode=='read-error' and self.index==1:raise OSError('scan interrupted')
  entries=[('a',False),('sub',True),('sub2',True),('link',True),('bad',False)] if self.path=='/root' else [('child',True),('nested',False)] if self.path=='/root/sub' else [('nested',False)]
  if mode=='large':
   if self.index>=1024:raise StopIteration
   entry=Entry('file-'+str(self.index))
  else:
   if self.index>=len(entries):raise StopIteration
   entry=Entry(*entries[self.index])
  self.index+=1;return entry
namespace={'_SafeNames':Names,'_SafeValues':Values}
tree=ast.parse(source);nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_safe_walk_files']
exec(compile(ast.Module(body=nodes,type_ignores=[]),'<walk>','exec'),namespace)
with patch('os.scandir',Scan),patch('os.path.islink',side_effect=lambda path:path=='/root/link' or mode=='symlink-change' and changed and path=='/root/sub2'):
 expected=[os.path.join(directory,name) for directory,_,names in os.walk('/root') for name in names]
 assert handles==0
 tracking=True;peak=0;changed=False
 walked=namespace['_safe_walk_files']('/root')
 try:
  if mode=='early':assert next(walked)==expected[0]
  else:assert [str(path) for path in walked]==expected
 except PermissionError as error:
  assert mode=='storage-error' and str(error)=='storage denied'
 else:assert mode!='storage-error'
 finally:walked.close()
 assert handles==0 and peak==1
assert stores and all(store.closed for store in stores)
`],{input:JSON.stringify([readFileSync(new URL('./package-program.py',import.meta.url),'utf8'),mode]),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
