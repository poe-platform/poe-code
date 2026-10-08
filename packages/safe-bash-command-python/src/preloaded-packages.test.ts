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

for(const mode of ['large','missing-name','decode-error','storage-error'])test('preloaded native metadata uses bounded reads before sealing: '+mode,async()=>{
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import ast,asyncio,io,json,pathlib,sys,importlib.metadata as metadata
from unittest.mock import patch
source,mode=json.load(sys.stdin)
tree=ast.parse(source)
end=next(i for i,node in enumerate(tree.body) if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='_safe_preloaded' for t in node.targets))
names=('_SafeMetadataText','_safe_read_metadata_text','_safe_distribution_metadata','_SafePreloaded')
body=[node for node in tree.body[:end+1] if isinstance(node,(ast.FunctionDef,ast.ClassDef)) and node.name in names or node is tree.body[end]]
stores=[];opened=[];events=[]
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
  assert 0<size<=8192,('unbounded bootstrap metadata read',size)
  if mode=='decode-error' and self.tell()>=8192:raise UnicodeDecodeError('utf-8',b'\xff',0,1,'invalid start byte')
  return super().read(size)
def open_file(path,*args,**kwargs):
 if path.name!='METADATA':raise FileNotFoundError(str(path))
 value=File(('' if mode=='missing-name' else 'Name: Host_Package\n')+'Version: 1\n\n'+'description 😀\n'*10000)
 opened.append(value);return value
async def snapshot(operation,name=None):
 assert all(value.closed for value in opened)
 assert all(value.closed for value in stores)
 events.append((operation,name))
namespace={'_safe_metadata':metadata,'_SafeValues':Values,'_safe_name':lambda name:name.lower().replace('_','-'),'_safe_package_preloaded':snapshot}
code=compile(ast.Module(body=body,type_ignores=[]),'<bootstrap>','exec',flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
with patch.object(pathlib.Path,'open',open_file),patch.object(metadata,'distributions',lambda:iter([metadata.PathDistribution(pathlib.Path('/host.dist-info'))])):
 try:asyncio.run(eval(code,namespace))
 except (UnicodeDecodeError,OSError) as error:
  assert mode in ('decode-error','storage-error'),error
  assert events==[('start',None)],events
 else:
  assert mode in ('large','missing-name')
  assert events==[('start',None)]+([('add','host-package')] if mode=='large' else [])+[('seal',None)],events
assert opened and stores
assert all(value.closed for value in opened+stores)
`],{input:JSON.stringify([await loadPythonPackageProgram(),mode]),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
