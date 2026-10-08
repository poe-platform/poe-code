import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createPythonPackageEnvironment} from './provisioning.js';
import {loadPythonPackageProgram} from './package-program.js';

for(const retirement of ['commit','finish','abort','dispose'])test('preloaded package snapshot spills independently of wheel indexes and retires on '+retirement,async()=>{
 const fs=new MemoryFileSystem(),controller=new AbortController();
 const environment=createPythonPackageEnvironment(),context={fs,cwd:'/',signal:controller.signal},start=await environment.prepare(context);
 const call=(operation:string,...args:unknown[])=>environment.dispatch('package-index',[start.session,operation,...args],context);
 try{
  await call('names-start');
  for(let i=0;i<130;i++)await call('names-add','host-'+i);
  await call('names-add','host-0');await call('names-seal');
  assert.ok((await fs.readdir('/')).some(item=>item.name.startsWith('.zip-metadata-')));
  await call('start');await call('append','new-package','0','payload');await call('seal','1');await call('close');
  assert.equal(await call('names-has','host-0'),true);
  assert.equal(await call('names-has','host-129'),true);
  assert.equal(await call('names-has','new-package'),false);
  if(retirement==='commit'){await environment.dispatch('package-commit',[start.session,[]],context);assert.deepEqual((await fs.readdir('/')).map(item=>item.name),['.python-install-1'],'only the environment manifest survives publication');}
  if(retirement==='finish'){await environment.finish(start);assert.deepEqual(await fs.readdir('/'),[]);}
  if(retirement==='abort')controller.abort(new Error('cancelled'));
 }finally{await environment.dispose();}
 assert.deepEqual(await fs.readdir('/'),[]);
});

test('preloaded package snapshot rejects mutation after sealing',async()=>{
 const fs=new MemoryFileSystem(),context={fs,cwd:'/',signal:new AbortController().signal},environment=createPythonPackageEnvironment(),start=await environment.prepare(context);
 try{
  await environment.dispatch('package-index',[start.session,'names-start'],context);
  await environment.dispatch('package-index',[start.session,'names-seal'],context);
  await assert.rejects(environment.dispatch('package-index',[start.session,'names-add','late'],context),/sealed/);
 }finally{await environment.finish(start);await environment.dispose();}
});

test('preloaded distribution discovery snapshots normalized names with bounded guest retention',async()=>{
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import ast,asyncio,json,sys,types
source=json.load(sys.stdin)
tree=ast.parse(source)
# Execute the maintained startup through the preloaded snapshot, without the resolver.
end=next(index for index,node in enumerate(tree.body) if isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id=='_safe_manager' for target in node.targets))
# Retain only the snapshot statements and required imports; unrelated installer helpers have no startup effects here.
body=[]
for node in tree.body[:end]:
 if isinstance(node,ast.ImportFrom) and node.module and node.module.startswith('micropip'):
  if any(alias.asname=='_safe_name' for alias in node.names):body.append(ast.parse('_safe_name=lambda name:name.lower().replace("_","-")').body[0])
  continue
 if isinstance(node,ast.ClassDef) and node.name!='_SafePreloaded':continue
 if isinstance(node,ast.Assign) and any(isinstance(target,ast.Attribute) for target in node.targets):continue
 body.append(node)
sys.modules['pyodide.ffi']=types.SimpleNamespace(run_sync=lambda value:value)
class Name(str):
 live=0
 def __new__(cls,value):
  obj=super().__new__(cls,value);cls.live+=1
  assert cls.live<=3,'preloaded names accumulated: '+str(cls.live)
  return obj
 def __del__(self):Name.live-=1
class Distribution:
 def __init__(self,index):self.index,self.reads=index,0
 @property
 def metadata(self):
  self.reads+=1
  assert self.reads==1,'distribution metadata read twice'
  return {'Name':Name('Host_'+str(self.index))}
import importlib.metadata
importlib.metadata.distributions=lambda:(Distribution(i) for i in range(1024))
seen=set();sealed=False
class Result:
 def __init__(self,value):self.value=value
 def __await__(self):
  if False:yield
  return self.value
 def __bool__(self):return bool(self.value)
def snapshot(operation,name=None):
 global sealed
 if operation=='start':return Result(None)
 if operation=='add':
  assert not sealed
  seen.add(str(name));return Result(None)
 if operation=='seal':sealed=True;return Result(None)
 if operation=='has':
  assert sealed
  return Result(name in seen)
 raise AssertionError(operation)
namespace={'_safe_package_preloaded':snapshot,'_SafeWheelInfo':types.SimpleNamespace(from_url=lambda url:None)}
code=compile(ast.Module(body=body,type_ignores=[]),'<preloaded snapshot>','exec',flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
result=eval(code,namespace)
if result is not None:asyncio.run(result)
assert len(seen)==1024 and sealed
preloaded=namespace['_safe_preloaded']
assert 'host-0' in preloaded and 'host-1023' in preloaded
assert 'new-package' not in preloaded
`],{input:JSON.stringify(await loadPythonPackageProgram()),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
