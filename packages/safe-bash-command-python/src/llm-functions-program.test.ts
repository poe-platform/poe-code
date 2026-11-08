import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {pythonLlmFunctionsProgram} from './llm-functions-program.js';

const python = process.env.LLM_TEST_PYTHON ?? 'python3';
const available = spawnSync(python, ['-B', '-c', 'from importlib.metadata import version; assert version("llm") == "0.27.1"'], {timeout: 5000}).status === 0;
test('pinned Python function sessions preserve state, async calls, schemas and bounded output', {skip: !available && !process.env.LLM_TEST_PYTHON ? 'Requires pinned llm==0.27.1' : false}, () => {
  const result = spawnSync(python, ['-B', '-c', `
import asyncio,json,sys,types
source=json.load(sys.stdin)
definitions=['state = 0\\ndef add(value: int):\\n global state\\n state += value\\n return state', 'import asyncio\\nasync def large(value: int):\\n await asyncio.sleep(0)\\n return "界" * value']
registered=[]; output={}; done=[]; errors=[]
queue=[dict(id=1,tool=0,arguments={"value":2}),dict(id=2,tool=0,arguments={"value":3}),dict(id=3,tool=1,arguments={"value":50000}),dict(id=4,tool=0,arguments={"bad":1}),None]
def call(capability,payload):
 assert capability=='llm_tools'
 op=payload['op']
 if op=='definitions': return definitions
 if op=='selection': return {}
 if op=='admit': return None
 if op=='register': registered.append(payload)
 elif op=='ready': pass
 elif op=='text':
  assert len(payload['text']) <= 4096
  output[payload['id']]=output.get(payload['id'],'')+payload['text']
 elif op=='done': done.append(payload['id'])
 elif op=='error': errors.append(payload)
 else: raise AssertionError(payload)
class Bridge:
 async def wait(self,*args,**kwargs):
  await asyncio.sleep(0)
  return queue.pop(0)
sys.modules['safe_host']=types.SimpleNamespace(call=call)
sys.modules['_poe_llm_capability']=types.SimpleNamespace(bridge=Bridge())
sys.modules['llm_safe_host']=types.SimpleNamespace(_attachment_type=lambda a:a.type)
exec(source,{})
assert [t['name'] for t in registered]==['add','large']
assert registered[0]['inputSchema']['properties']['value']['type']=='integer'
assert registered[1]['asynchronous']
assert output=={1:'2',2:'5',3:'界'*50000}
assert sorted(done)==[1,2,3]
assert len(errors)==1 and errors[0]['id']==4
`], {input: JSON.stringify(pythonLlmFunctionsProgram), encoding: 'utf8', timeout: 5000});
  assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + result.stderr);
});

for (const [definition, message] of [['/missing-function-definition.py', 'File not found: /missing-function-definition.py'], ['def broken(:', 'Error in --functions definition:']])
  test(`pinned function initialization error: ${definition}`, {skip: !available && !process.env.LLM_TEST_PYTHON ? 'Requires pinned llm==0.27.1' : false}, () => {
    const result = spawnSync(python, ['-B', '-c', `
import json,sys,types
source,definition,expected=json.load(sys.stdin)
failures=[]
def call(capability,payload):
 if payload['op']=='definitions': return [definition]
 if payload['op']=='selection': return {}
 if payload['op']=='admit': return None
 if payload['op']=='exit': failures.append('exit'); return None
 raise AssertionError(payload)
sys.modules['safe_host']=types.SimpleNamespace(call=call)
sys.modules['_poe_llm_capability']=types.SimpleNamespace(bridge=None)
sys.modules['llm_safe_host']=types.SimpleNamespace(_attachment_type=lambda a:a.type)
try:exec(source,{})
except SystemExit as error:assert error.code==1
else:raise AssertionError('missing native CLI failure')
assert failures==['exit'], failures
`], {input: JSON.stringify([pythonLlmFunctionsProgram, definition, message]), encoding: 'utf8', timeout: 5000});
    assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + result.stderr); assert.equal(result.stdout, ''); assert.ok(result.stderr.startsWith('Error: ' + message), result.stderr);
  });

for (const asynchronous of [false, true]) test(`pinned registered toolbox preserves preparation and instance state in async=${asynchronous}`, {skip: !available && !process.env.LLM_TEST_PYTHON ? 'Requires pinned llm==0.27.1' : false}, () => {
  const result = spawnSync(python, ['-B', '-c', `
import asyncio,json,sys,types
source,asynchronous=json.load(sys.stdin)
definition='''import llm as _llm
from llm.plugins import pm as _pm
class _Counter(_llm.Toolbox):
 def __init__(self, start=0): self.value = start
 def prepare(self): self.value += 10
 async def prepare_async(self): self.value += 100
 def add(self, value: int):
  self.value += value
  return self.value
 def peek(self): return self.value
class _Plugin:
 @_llm.hookimpl
 def register_tools(self, register): register(_Counter, name="Counter")
_pm.register(_Plugin(), name="fixture")
'''
registered=[]; output={}; errors=[]
queue=[dict(id=0,prepare=True,asynchronous=asynchronous),dict(id=1,tool=0,arguments={"value":2}),dict(id=2,tool=1,arguments={}),None]
prepared=asyncio.Event()
def call(capability,payload):
 op=payload['op']
 if op=='definitions': return [definition]
 if op=='selection': return dict(names=['Counter(3)'],discovery=False)
 if op=='admit': return None
 if op=='register': registered.append(payload)
 elif op=='ready': pass
 elif op=='text': output[payload['id']]=output.get(payload['id'],'')+payload['text']
 elif op=='done':
  if payload['id']==0: prepared.set()
 elif op in ('error','failed'): errors.append(payload); prepared.set()
 else: raise AssertionError(payload)
class Bridge:
 async def wait(self,*args,**kwargs):
  await asyncio.sleep(0)
  if queue and queue[0] and queue[0].get('id')==1: await prepared.wait()
  return queue.pop(0)
sys.modules['safe_host']=types.SimpleNamespace(call=call)
sys.modules['_poe_llm_capability']=types.SimpleNamespace(bridge=Bridge())
sys.modules['llm_safe_host']=types.SimpleNamespace(_attachment_type=lambda a:a.type)
exec(source,{})
assert not errors,errors
assert [t['name'] for t in registered]==['_Counter_add','_Counter_peek'],registered
assert all(t['plugin']=='fixture' for t in registered)
expected='205' if asynchronous else '25'
assert output=={1:expected,2:expected},output
`], {input: JSON.stringify([pythonLlmFunctionsProgram, asynchronous]), encoding: 'utf8', timeout: 5000});
  assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('pinned plugin loading discovers host-selected distribution metadata and callable tools', {skip: !available && !process.env.LLM_TEST_PYTHON ? 'Requires pinned llm==0.27.1' : false},()=>{
  const result=spawnSync(python,['-B','-c',`
import asyncio,json,sys,types
import llm
from importlib import metadata
source=json.load(sys.stdin)
llm.plugins.LLM_LOAD_PLUGINS=''
llm.plugins.DEFAULT_PLUGINS=()
plugin=types.ModuleType('fixture_plugin')
@llm.hookimpl
def register_tools(register):
 def greet(name: str): return 'hello ' + name
 register(greet)
plugin.register_tools=register_tools
distribution=types.SimpleNamespace(name='fixture-plugin',metadata={'Name':'fixture-plugin'},version='1.0',entry_points=[types.SimpleNamespace(group='llm',name='fixture',load=lambda:plugin)])
original=metadata.distribution
metadata.distribution=lambda name: distribution if name=='fixture-plugin' else original(name)
registered=[];plugins=[];output={};errors=[]
queue=[dict(id=1,tool=0,arguments={'name':'Ada'}),None]
def call(capability,payload):
 assert capability=='llm_tools'
 op=payload['op']
 if op=='definitions': return []
 if op=='selection': return dict(names=['greet'],plugins=['fixture-plugin'],pluginQuery=dict(all=False,hooks=[]))
 if op=='plugins': plugins.extend(payload['plugins'])
 elif op=='register': registered.append(payload)
 elif op in ('admit','ready','done'): pass
 elif op=='text': output[payload['id']]=output.get(payload['id'],'')+payload['text']
 elif op in ('error','failed'): errors.append(payload)
 else: raise AssertionError(payload)
class Bridge:
 async def wait(self,*args,**kwargs):
  await asyncio.sleep(0)
  return queue.pop(0)
sys.modules['safe_host']=types.SimpleNamespace(call=call)
sys.modules['_poe_llm_capability']=types.SimpleNamespace(bridge=Bridge())
sys.modules['llm_safe_host']=types.SimpleNamespace(_attachment_type=lambda value:value.type)
exec(source,{})
assert not errors,errors
assert [tool['name'] for tool in registered]==['greet'],registered
assert registered[0]['plugin']=='fixture',registered
assert plugins==[dict(name='fixture-plugin',version='1.0',hooks=['register_tools'])],plugins
assert output=={1:'hello Ada'},output
assert llm.plugins.LLM_LOAD_PLUGINS==''
assert llm.plugins.DEFAULT_PLUGINS==()
`],{input:JSON.stringify(pythonLlmFunctionsProgram),encoding:'utf8',timeout:5000});
  assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
