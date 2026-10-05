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
 if payload['op']=='admit': return None
 if payload['op']=='failed': failures.append(payload['message']); return None
 raise AssertionError(payload)
sys.modules['safe_host']=types.SimpleNamespace(call=call)
sys.modules['_poe_llm_capability']=types.SimpleNamespace(bridge=None)
sys.modules['llm_safe_host']=types.SimpleNamespace(_attachment_type=lambda a:a.type)
exec(source,{})
assert len(failures)==1 and failures[0].startswith(expected), failures
`], {input: JSON.stringify([pythonLlmFunctionsProgram, definition, message]), encoding: 'utf8', timeout: 5000});
    assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + result.stderr);
  });
