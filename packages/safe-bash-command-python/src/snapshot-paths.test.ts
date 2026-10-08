import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

test('restored snapshot paths retain one resolved root instead of every package path',()=>{
 const source=readFileSync(new URL('./package-program.py',import.meta.url),'utf8');
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import ast,gc,json,sys,types
from unittest.mock import patch
source=json.load(sys.stdin);tree=ast.parse(source)
def assigns(node,names):return isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id in names for t in node.targets)
start=next(i for i,n in enumerate(tree.body) if assigns(n,('_safe_snapshot_paths','_safe_snapshot_root')))
end=next(i for i in range(start,len(tree.body)) if assigns(tree.body[i],('_safe_restoring',)))
code=compile(ast.Module(body=tree.body[start:end],type_ignores=[]),'<snapshot paths>','exec')
class Text(str):
 live=peak=0
 def __new__(cls,value):
  obj=super().__new__(cls,value);cls.live+=1;cls.peak=max(cls.peak,cls.live);return obj
 def __del__(self):Text.live-=1
alias='/real';created=[]
class Path:
 def __init__(self,value):self.value=value
 def __truediv__(self,name):return Path(self.value+'/'+name)
 def resolve(self):return Path(self.value.replace('/alias',alias))
 def mkdir(self):created.append(self.value)
 def write_text(self,text):pass
 def __str__(self):return Text(self.value)
class Records:
 def __contains__(self,name):return name.startswith('package-') and name[8:].isdigit() and int(name[8:])<4096
 def __iter__(self):
  for i in range(4096):yield 'package-'+str(i)
 def field(self,name,index):
  assert index in (1,2),'restoration requested removal lists'
  return Text('metadata' if index==1 else 'origin')
 def origin(self,name):return None
 def items(self):raise AssertionError('restoration requested full records')
records=Records()
def distribution(path):
 name=path.value.rsplit('/',1)[-1].removesuffix('-snapshot.dist-info').replace('_','-')
 return types.SimpleNamespace(metadata={'Name':name},version='1')
namespace={'_safe_distribution_metadata':lambda distribution:distribution.metadata,'_safe_metadata_only':True,'_safe_record_by_name':records,'_safe_preloaded':{'package-0'},'_safe_name':lambda name:name,'_SafeRequirement':lambda requirement:None,'_safe_metadata':types.SimpleNamespace(Distribution=types.SimpleNamespace(at=distribution),MetadataPathFinder=types.SimpleNamespace(invalidate_caches=lambda:None))}
with patch('pathlib.Path',Path),patch('sysconfig.get_path',return_value='/alias/site'):
 exec(code,namespace)
 assert Text.peak<=4,('snapshot path strings retained',Text.peak)
 assert len(created)==4095 and created[0]=='/real/site/package_1-snapshot.dist-info'
 get=namespace['_safe_snapshot_path']
 assert get('package-0') is None and get('absent') is None
 assert get('package-42')=='/real/site/package_42-snapshot.dist-info'
 alias='/retargeted'
 assert get('package-42')=='/real/site/package_42-snapshot.dist-info','resolved parent identity drifted'
 namespace['_safe_metadata_only']=False
 exec(code,namespace)
 assert namespace['_safe_snapshot_path']('package-42') is None
 assert len(created)==4095
`],{input:JSON.stringify(source),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.stderr,'');
});
