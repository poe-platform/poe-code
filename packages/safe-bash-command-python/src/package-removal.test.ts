import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

for(const mode of ['large','folders','failure','early'])test('removal listing compacts on caller storage and retires iterators: '+mode,()=>{
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import ast,contextlib,json,os,sys,types
from unittest.mock import patch
source,mode=json.load(sys.stdin)
class Name(str):
 live=0
 def __new__(cls,value):
  obj=super().__new__(cls,value);cls.live+=1;return obj
 def __del__(self):Name.live-=1
class Path:
 def __init__(self,value):self.value=value
 def __str__(self):return Name(self.value)
opened=[]
class Names:
 def __init__(self,values=()):
  self.values={};self.closed=False;opened.append(self)
  for value in values:self.add(value)
 def add(self,value):self.values[str(value)]=None
 def __contains__(self,value):return value in self.values
 def __iter__(self):
  for value in self.values:yield Name(value)
 def ordered(self,key=None):
  for value in sorted(self.values,key=key):
   yield Name(value)
   assert Name.live<=16,('retained path list',Name.live)
 def close(self):self.closed=True
paths=['/site/a/__init__.py','/site/a/a.py','/site/a/cache.pyc','/site/a/sub/b.py','/site/b.txt','/site/pkg.dist-info/METADATA','/site/pkg.dist-info/RECORD']
if mode=='large':paths=['/site/file-'+str(i).zfill(5) for i in range(1024)]
def files(dist):
 for value in paths:
  yield Path(value)
  assert Name.live<=16,('retained distribution paths',Name.live)
def walk(folder):
 if mode=='failure':raise PermissionError('walk denied')
 if folder=='/site/a':yield '/site/a',[],['__init__.py','a.py','cache.pyc','manual.txt']
 if folder=='/site/pkg.dist-info':yield folder,[],['METADATA','RECORD']
sys.modules['micropip._utils']=types.SimpleNamespace(get_files_in_distribution=files)
namespace={'_SafeNames':Names,'_safe_distribution_files':files,'_safe_walk_files':lambda folder:(os.path.join(directory,name) for directory,_,names in walk(folder) for name in names)}
tree=ast.parse(source);nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_safe_removal_listing']
exec(compile(ast.Module(body=nodes,type_ignores=[]),'<removal>','exec'),namespace)
try:
 with patch('os.walk',walk),patch('os.path.isfile',return_value=True):
  listing=namespace['_safe_removal_listing'](None)
  try:
   remove=next(listing)
   if mode=='early':
    assert next(remove)=='/site/a/*'
    listing.close()
    assert all(value.closed for value in opened)
    sys.exit(0)
   actual=[str(path) for path in remove]
   skip=next(listing);skipped=[str(path) for path in skip]
   assert next(listing,None) is None
  finally:listing.close()
except PermissionError as error:
 assert mode=='failure' and str(error)=='walk denied'
else:
 assert mode!='failure'
 assert actual==(paths if mode=='large' else ['/site/a/*','/site/b.txt','/site/pkg.dist-info/*'])
 assert skipped==([] if mode=='large' else ['/site/a/manual.txt'])
assert opened and all(value.closed for value in opened)
`],{input:JSON.stringify([readFileSync(new URL('./package-program.py',import.meta.url),'utf8'),mode]),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
