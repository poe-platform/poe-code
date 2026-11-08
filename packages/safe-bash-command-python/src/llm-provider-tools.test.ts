import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { pythonLlmProvider } from './llm-provider.js';

const python = process.env.LLM_TEST_PYTHON ?? 'python3';
const available = spawnSync(python, ['-B', '-c', 'from importlib.metadata import version; assert version("llm") == "0.27.1"'], {timeout: 5000}).status === 0;

for (const asynchronous of [false, true]) test(`genuine Python tools use the shared provider: async=${asynchronous}`, {skip: !available && !process.env.LLM_TEST_PYTHON ? 'Requires pinned llm==0.27.1' : false}, () => {
  const result = spawnSync(python, ['-B', '-c', `
import asyncio, json, sys, types
from contextlib import contextmanager
from importlib.metadata import version
import llm
assert version("llm") == "0.27.1"
payloads = []
inputs, closed, writes = {}, [], []
class HostError(Exception): pass
def call(service,request):
 operation,payload=request["operation"],request["payload"]
 if operation=="input_open":
  handle=str(len(inputs)); inputs[handle]=bytearray(); return handle
 if operation=="input_write":
  writes.append(len(payload["bytes"])); inputs[payload["id"]].extend(payload["bytes"]); return None
 if operation=="input_close": closed.append(payload["id"]); return None
 raise AssertionError(operation)
def events(payload):
 payloads.append(payload)
 yield {"type":"response","response":{"model":"fixture","toolCalls":[{"id":"call-1","name":"lookup","arguments":{"query":"Zürich"}}]}}
@contextmanager
def stream(service,payload): yield events(payload)
sys.modules["safe_host"] = types.SimpleNamespace(call=call,stream=stream,HostError=HostError)
class Bridge:
 async def stream(self,payload):
  for event in events(payload): yield event
sys.modules["_poe_llm_capability"] = types.SimpleNamespace(bridge=Bridge())
sys.modules["poe_llm"] = types.SimpleNamespace(LlmError=HostError)
provider = types.ModuleType("fixture_provider")
exec(json.load(sys.stdin),provider.__dict__)
entry={"id":"fixture","capabilities":["messages","tools"],"metadata":{"attachmentTypes":[],"options":{}}}
def lookup(query: str):
 """Look up a city."""
 return "found " + query
tool=llm.Tool.function(lookup)
model=provider.${asynchronous ? 'HostAsyncModel' : 'HostModel'}(entry)
assert model.supports_tools
async def check():
 response=model.prompt("lookup",tools=[tool])
 ${asynchronous ? 'assert await response.text() == ""' : 'assert response.text() == ""'}
 calls=${asynchronous ? 'await response.tool_calls()' : 'response.tool_calls()'}
 assert len(calls)==1 and calls[0].name=="lookup" and calls[0].tool_call_id=="call-1"
 results=${asynchronous ? 'await response.execute_tool_calls()' : 'response.execute_tool_calls()'}
 assert results[0].output=="found Zürich"
 assert payloads[0]["tools"]==[{"name":"lookup","description":"Look up a city.","inputSchema":tool.input_schema}]
 # The caller supplies prior responses; the adapter owns no conversation storage.
 conversation=types.SimpleNamespace(responses=[response])
 prompt=llm.Prompt("",model,tools=[tool],tool_results=results,options=model.Options())
 next_response=${asynchronous ? 'llm.AsyncResponse' : 'llm.Response'}(prompt,model,False)
 with provider._request(model,prompt,False,next_response,conversation) as payload:
  assert payload["messages"]==[{"role":"user","content":"lookup"},{"role":"assistant","content":"","toolCalls":[{"name":"lookup","arguments":{"query":"Zürich"},"id":"call-1"}]},{"role":"tool","content":"found Zürich","toolCallId":"call-1"}]
 results[0].output="界"*65536
 try:
  with provider._request(model,prompt,False,next_response,conversation) as payload:
   handle=payload["messages"][-1]["content"]["spool"]
   assert bytes(inputs[handle]).decode("utf-8")==results[0].output
   assert max(writes)<=16384
   raise RuntimeError("caller stopped")
 except RuntimeError: pass
 assert closed==list(inputs)
 assert model.supports_tools and not provider.${asynchronous ? 'HostAsyncModel' : 'HostModel'}({**entry,"capabilities":[]}).supports_tools
asyncio.run(check())
`], {input: JSON.stringify(pythonLlmProvider), encoding: 'utf8', timeout: 5000});
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('platform provider policy permits tool plugins but rejects model hooks and entrypoint loading', {skip: !available && !process.env.LLM_TEST_PYTHON ? 'Requires pinned llm==0.27.1' : false}, () => {
  const result = spawnSync(python, ['-B', '-c', `
import json,sys,types,llm
provider=types.ModuleType('fixture_provider')
exec(json.load(sys.stdin),provider.__dict__)
llm.plugins.load_plugins()
provider.restrict_providers()
class Tools:
 @llm.hookimpl
 def register_tools(self,register): register(lambda: 'tool',name='fixture_tool')
class Models:
 @llm.hookimpl(specname='register_models')
 def register_tools(self,register): pass
llm.plugins.pm.register(Tools(),'fixture-tools')
tools=llm.get_tools()
assert tools['llm_version'].implementation()=='0.27.1'
assert tools['fixture_tool'].implementation()=='tool'
for operation in (lambda:llm.plugins.pm.register(Models(),'fixture-models'),lambda:llm.plugins.pm.register(object(),'empty'),lambda:llm.plugins.pm.load_setuptools_entrypoints('llm')):
 try: operation()
 except llm.ModelError as error: assert 'platform-configured providers' in str(error)
 else: raise AssertionError('provider policy bypassed')
assert llm.plugins.pm.get_plugin('fixture-models') is None
`], {input: JSON.stringify(pythonLlmProvider), encoding: 'utf8', timeout: 5000});
  assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + result.stderr);
});
