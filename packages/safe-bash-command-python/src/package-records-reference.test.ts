import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {loadPythonPackageProgram} from './package-program.js';

test('saved-record restoration validates snapshots while retaining only the current native record',async()=>{
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import ast,asyncio,json,sys,types,gc
from pip._vendor.packaging.requirements import Requirement
from pip._vendor.packaging.utils import canonicalize_name
source=json.load(sys.stdin);tree=ast.parse(source)
start=next(i for i,node in enumerate(tree.body) if isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id=='_safe_uninstall' for target in node.targets))
end=next(i for i,node in enumerate(tree.body[start:],start) if isinstance(node,ast.If) and isinstance(node.test,ast.Name) and node.test.id=='_safe_metadata_only')
code=compile(ast.Module(body=tree.body[start:end],type_ignores=[]),'<saved records>','exec',flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
class Record(list):
 live=0
 def __init__(self,value):
  super().__init__(value);Record.live+=1
  assert Record.live<=3,'complete snapshot retained in Python'
 def __del__(self):Record.live-=1
def decode(value):
 parsed=json.loads(value)
 if isinstance(parsed,list):
  if parsed and isinstance(parsed[0],list):return [Record(row) for row in parsed]
  if len(parsed)>=5:return Record(parsed)
 return parsed
class Result:
 def __init__(self,value):self.value=value
 def __await__(self):
  if False:yield
  return self.value
sys.modules['pyodide.ffi']=types.SimpleNamespace(run_sync=lambda result:result.value)
def row(name,legacy=False):return [name,'Name: '+name+'\nVersion: 1\n','file:///'+name+'.whl',[],[]]+([] if legacy else ['origin-'+name])
for rows in [None,[],[row('package-'+str(i),i%2==0) for i in range(130)],[row('duplicate'),row('duplicate')],[row('NonCanonical')],[row('package>=1')]]:
 index={};sealed=False
 def request(operation,key=None,value=None):
  global sealed
  if operation=='start':return Result(-1 if rows is None else len(rows))
  if operation=='read':return Result(json.dumps(rows[key]))
  if operation=='has':return Result(key in index)
  if operation=='add':
   assert not sealed
   index[key]=value;return Result(None)
  if operation=='seal':sealed=True;return Result(None)
  if operation=='get':
   assert sealed
   return Result(json.dumps(rows[index[key]] if key in index else None))
  raise AssertionError(operation)
 namespace={'_safe_json':types.SimpleNamespace(loads=decode),'_safe_package_records_json':json.dumps(rows),'_safe_package_uninstall_json':'{}','_safe_package_record':request,'_SafeRequirement':Requirement,'_safe_name':canonicalize_name}
 invalid=rows and (rows[0][0] in ['duplicate','NonCanonical','package>=1'])
 try:
  pending=eval(code,namespace)
  if pending is not None:asyncio.run(pending)
 except ValueError as error:
  assert invalid and str(error)=='Invalid Python package metadata snapshot',error
 else:
  assert not invalid
  assert namespace['_safe_metadata_only']==(rows is not None)
  records=namespace['_safe_record_by_name']
  assert len(records)==len(rows or [])
  for ordinal,(name,value) in enumerate(records.items()):
   expected=rows[ordinal] if len(rows[ordinal])==6 else rows[ordinal]+[None]
   assert value==expected
   assert records[name]==expected and records.origin(name)==expected[5]
  assert records.get('missing') is None
  assert 'missing' not in records
 namespace.clear();gc.collect()
`],{input:JSON.stringify(await loadPythonPackageProgram()),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
