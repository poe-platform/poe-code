import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

test('multiple package indexes combine version candidates and retain fallback failures',async()=>{
 const source=await readFile(new URL('./package-program.py',import.meta.url),'utf8');
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import ast,asyncio,json,sys,types
from itertools import chain
source=json.load(sys.stdin)
selected=[node for node in ast.walk(ast.parse(source)) if isinstance(node,ast.AsyncFunctionDef) and node.name=='_safe_query_all']
assert len(selected)==1
calls=[]
async def query(name,urls,**kwargs):
 calls.append((name,urls,kwargs))
 if urls==['missing']:raise ValueError('missing index')
 return types.SimpleNamespace(releases={1:iter(['first'])} if urls==['primary'] else {2:iter(['newest']),1:iter(['second'])})
namespace={'_safe_query':query,'_safe_chain':chain,'_safe_index':types.SimpleNamespace(ProjectInfo=lambda name,releases:types.SimpleNamespace(name=name,releases=releases))}
exec(compile(ast.Module(body=selected,type_ignores=[]),'<indexes>','exec'),namespace)
async def verify():
 result=await namespace['_safe_query_all']('root',['primary','missing','extra'],compat_layer='host')
 assert result.name=='root'
 assert list(result.releases)==[1,2]
 assert list(result.releases[1])==['first','second']
 assert list(result.releases[2])==['newest']
 assert calls==[('root',[url],{'compat_layer':'host'}) for url in ['primary','missing','extra']]
 for urls in [[],['missing']]:
  try:await namespace['_safe_query_all']('root',urls)
  except ValueError:pass
  else:raise AssertionError('missing indexes accepted')
asyncio.run(verify())
`],{input:JSON.stringify(source),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
