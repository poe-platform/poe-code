import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createLlmService} from 'safe-bash-command-llm';
import {createPythonLlmCapability} from './llm-capability.js';
import {pythonLlmProvider} from './llm-provider.js';
import type {PythonHostValue} from './host-capabilities.js';

const signal = new AbortController().signal;
for (const source of [false, true]) test(`Python selects paired async metadata and transport: source=${source}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/prompt', new TextEncoder().encode('hello'));
  let calls = 0;
  const complete = async function* (request: {async?: boolean | undefined; stream?: boolean | undefined; options: unknown}) {
    calls++; assert.equal(request.async, true); assert.equal(request.stream, false);
    assert.deepEqual(request.options, {count: 2}); yield 'done';
  };
  const service = createLlmService({providers: [{name: 'fixture', models: [{id: 'paired', aliases: ['alias'],
    inputSources: false, asyncModel: {inputSources: true, canStream: false, capabilities: ['tools'], options: {count: {type: 'integer'}}}}, {id: 'sync'}], complete, completeSources: complete}]});
  const capability = createPythonLlmCapability({fs, cwd: '/'}, service);
  const result = await capability.call!({operation: 'complete', payload: {model: 'alias', async: true, stream: true,
    options: {count: 2}, tools: [{name: 'lookup', inputSchema: {}}], prompt: source ? {path: '/prompt'} : 'hello'}}, {signal});
  assert.deepEqual(result, {model: 'paired', text: 'done', data: []});
  await assert.rejects(capability.call!({operation: 'complete', payload: {model: 'sync', async: true, prompt: {path: '/missing'}}}, {signal}), /Unknown async model/);
  for (const invalid of [null, 1, 'true']) await assert.rejects(capability.call!({operation: 'complete', payload: {model: 'paired', async: invalid}}, {signal}), /Invalid LLM async option/);
  assert.equal(calls, 1);
  const catalog = await capability.call!({operation: 'models', payload: {}}, {signal}) as {[key: string]: PythonHostValue}[];
  assert.deepEqual(catalog[0]!.asyncModel, {id: 'paired', aliases: ['alias'], capabilities: ['tools'], metadata: {
    canStream: false, options: {count: {type: 'integer'}}, provider: 'fixture', attachmentTypes: [], outputType: 'text/plain'}});
  assert.equal(catalog[1]!.asyncModel, undefined);
  assert.deepEqual(await fs.readdir('/'), [{name: 'prompt', type: 'file'}]);
});

const python = process.env.LLM_TEST_PYTHON ?? 'python3';
const available = spawnSync(python, ['-B', '-c', 'from importlib.metadata import version; assert version("llm") == "0.27.1"'], {timeout: 5000}).status === 0;
test('genuine Python resolver exposes only declared async models and sends async mode', {skip: !available && !process.env.LLM_TEST_PYTHON ? 'Requires pinned llm==0.27.1' : false}, () => {
  const result = spawnSync(python, ['-B', '-c', `
import asyncio,json,sys,types
import llm
from unittest.mock import MagicMock
user_path=MagicMock()
user_path.__truediv__.return_value.exists.return_value=False
llm.user_dir=lambda: user_path
payloads=[]
entry={"id":"paired","aliases":["alias"],"capabilities":[],"metadata":{"attachmentTypes":[],"outputType":"text/plain"}}
entry["asyncModel"]={**entry,"capabilities":["tools"],"metadata":{**entry["metadata"],"canStream":False,"options":{"count":{"type":"integer"}}}}
sync={**entry,"id":"sync","aliases":[]}; del sync["asyncModel"]
class HostError(Exception): pass
def call(service,request):
 if request["operation"]=="models": return [entry,sync]
 if request["operation"]=="resolve_model": return "paired"
 raise AssertionError(request)
sys.modules["safe_host"]=types.SimpleNamespace(call=call,HostError=HostError)
class Bridge:
 async def stream(self,payload):
  payloads.append(payload)
  yield {"type":"text","text":"done"}
sys.modules["_poe_llm_capability"]=types.SimpleNamespace(bridge=Bridge())
sys.modules["poe_llm"]=types.SimpleNamespace(LlmError=HostError)
provider=types.ModuleType("fixture_provider")
exec(json.load(sys.stdin),provider.__dict__)
llm.plugins.pm.register(provider)
model=llm.get_async_model("alias")
assert model.supports_tools and not model.can_stream
assert not llm.get_model("alias").supports_tools
try: llm.get_async_model("sync")
except llm.UnknownModelError as error: assert str(error)=="'Unknown async model (sync model exists): sync'"
else: raise AssertionError("sync-only model was registered as async")
async def check():
 response=model.prompt("hello",count=2)
 assert await response.text()=="done"
 assert payloads[0]["async"] is True
 assert payloads[0]["stream"] is True
 assert payloads[0]["options"]=={"count":2}
asyncio.run(check())
`], {input: JSON.stringify(pythonLlmProvider), encoding: 'utf8', timeout: 5000});
  assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + result.stderr);
});
