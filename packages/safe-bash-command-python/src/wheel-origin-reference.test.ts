import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {loadPythonPackageProgram} from './package-program.js';
const python=process.env.LLM_TEST_PYTHON??'python3';
const available=spawnSync(python,['-B','-c','import pip; assert pip.__version__ == "21.2.4"'],{timeout:5000}).status===0;
test('direct wheel provenance matches pinned pip and never labels index or generated legacy wheels as direct',{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned pip==21.2.4':false},async()=>{
 const result=spawnSync(python,['-B','-c',String.raw`
import ast,asyncio,json,sys,types
from pip._internal.models.link import Link
from pip._internal.utils.direct_url_helpers import direct_url_from_link
program=ast.parse(json.load(sys.stdin)); captured=[]
class Wheel:
 @classmethod
 def from_url(cls,url):
  return types.SimpleNamespace(name='fixture',url=url,sha256=None,_data={'key':'digest'},_requires=[],filename='fixture-1-py3-none-any.whl',_project_name='fixture')
async def install(value):captured.append(json.loads(value))
namespace={'_safe_restoring':False,'_safe_record_by_name':types.SimpleNamespace(origin=lambda name:None),'_safe_name':lambda name:name,'_SafeWheelInfo':Wheel,'_safe_json':json,'_safe_package_wheel_install':install}
selected=[node for node in program.body if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) and node.name in ['read_source_origin','_safe_wheel_from_url','_safe_wheel_install'] or isinstance(node,ast.Assign) and any(isinstance(target,ast.Attribute) and isinstance(target.value,ast.Name) and target.value.id=='_SafeWheelInfo' and target.attr=='from_url' for target in node.targets)]
exec(compile(ast.Module(body=selected,type_ignores=[]),'<maintained-package-program>','exec'),namespace)
async def check():
 for url in ['file:///work/fixture-1-py3-none-any.whl','https://example.test/fixture-1-py3-none-any.whl#sha256=abc','https://example.test/fixture-1-py3-none-any.whl#md5=abc&sha256=def','https://user:synthetic@example.test/fixture-1-py3-none-any.whl#subdirectory=nested%20path','https://'+'$'+'{USER}:'+'$'+'{TOKEN}@example.test/fixture-1-py3-none-any.whl']:
  for kind in ['direct','index-no-hash','index-hash','legacy','built-source']:
   wheel=Wheel.from_url(url)
   if kind.startswith('index'):del wheel._safe_direct_url
   if kind=='index-hash':wheel.sha256='index-digest'
   if kind=='legacy':wheel._data['metadata']={}
   if kind=='built-source':wheel._data['metadata']={'direct_url.json':'{"url":"file:///original-source","dir_info":{}}'}
   await namespace['_safe_wheel_install'](wheel,'/target',types.SimpleNamespace(loadedPackages=types.SimpleNamespace()))
   metadata=captured[-1]['metadata']
   if kind=='direct':assert metadata['direct_url.json']==direct_url_from_link(Link(url)).to_json(),(url,metadata)
   elif kind=='built-source':assert metadata['direct_url.json']==wheel._data['metadata']['direct_url.json']
   else:assert 'direct_url.json' not in metadata,(kind,metadata)
   assert metadata['PYODIDE_SHA256']=='digest'
   namespace['_safe_restoring']=True
   namespace['_safe_record_by_name']=types.SimpleNamespace(origin=lambda name:metadata.get('direct_url.json'))
   restored=Wheel.from_url(url)
   await namespace['_safe_wheel_install'](restored,'/target',types.SimpleNamespace(loadedPackages=types.SimpleNamespace()))
   assert captured[-1]['metadata'].get('direct_url.json')==metadata.get('direct_url.json'),(kind,captured[-1])
   namespace['_safe_restoring']=False
asyncio.run(check())
`],{input:JSON.stringify(await loadPythonPackageProgram()),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
