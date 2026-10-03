import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { installPythonLlmModule } from '../../src/commands/python/llm-module.js';
import { pythonLlmReferenceModule } from '../../src/commands/python/llm-reference-module.js';

const testPython = process.env.LLM_TEST_PYTHON ?? process.env.LLM_REFERENCE_PYTHON ?? 'python3';
const pydanticAvailable = spawnSync(testPython, ['-B', '-c', 'import pydantic'], { timeout: 5000 }).status === 0;
const pythonDependency = pydanticAvailable ? false : 'Requires Python with Pydantic 2; set LLM_TEST_PYTHON or LLM_REFERENCE_PYTHON';

const setup = `
import sys, json, asyncio, types
bundle = json.load(sys.stdin)
_safe_llm_source = bundle["source"]
exec(bundle["registration"])
payloads = []
class Bridge:
 async def call(self, operation, payload):
  if operation == "resolve_model": return "fixture"
  if operation == "models": return [{"id":"fixture","metadata":{"attachmentTypes":["text/plain"]}}]
  if operation == "configuration": return {"default_model":"fixture","aliases":{},"model_options":{}}
  payloads.append(payload)
  return {"model":"fixture","text":"ok"}
 def stream(self, payload):
  async def generate():
   payloads.append(payload)
   yield {"type":"text","text":"ok"}
   yield {"type":"response","response":{"model":"fixture","text":"ok"}}
  return generate()
capability = types.ModuleType("_poe_llm_capability")
capability.bridge = Bridge()
sys.modules[capability.__name__] = capability
llm = types.ModuleType("llm")
sys.modules["llm"] = llm
exec(bundle["legacy"], llm.__dict__)
`;

function run(program: string): string {
  const globals = new Map<string, unknown>();
  let source: unknown, registration = '';
  installPythonLlmModule({globals, runPython(value) { source = globals.get('_safe_llm_source'); registration = value; }});
  const result = spawnSync(process.env.LLM_TEST_PYTHON ?? process.env.LLM_REFERENCE_PYTHON ?? 'python3', ['-B', '-c', setup + program], {input:JSON.stringify({source,registration,legacy:pythonLlmReferenceModule}),encoding:'utf8',timeout:5000});
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

test('legacy Python shim prompts preserve finite structured options', { skip: pythonDependency }, () => { run(`
model = llm.get_model("fixture")
assert model.prompt("hello", logit_bias={42:5}, stop=["end"]).text() == "ok"
assert payloads[-1]["options"] == {"logit_bias":{"42":5},"stop":["end"]}
cycle = []; cycle.append(cycle)
for value in [{"nested":float("inf")}, {"nested":9007199254740992}, cycle, {"nested":b"bytes"}]:
 before = len(payloads)
 try:
  model.prompt("invalid", value=value).text()
  raise AssertionError("invalid structured option accepted")
 except (TypeError, ValueError): pass
 assert len(payloads) == before
`); });

test('legacy Python shim dictionary and list options retain validation and transport', { skip: pythonDependency }, () => { run(`
model = llm.Model("fixture", metadata={"options": {
 "logit_bias": {"type":"object"}, "stop": {"type":"array"}
}})
assert model.Options.model_json_schema()["properties"]["logit_bias"]["type"] == "object"
assert model.Options.model_json_schema()["properties"]["stop"]["type"] == "array"
assert model.prompt("hello", logit_bias={42:5}, stop=["end"]).text() == "ok"
assert payloads[-1]["options"] == {"logit_bias":{"42":5},"stop":["end"]}
for options in [{"logit_bias":[]}, {"stop":{}}, {"unknown":True}]:
 before = len(payloads)
 try:
  model.prompt("invalid", **options).text()
  raise AssertionError("invalid declared option accepted")
 except ValueError: pass
 assert len(payloads) == before
`); });

test('legacy Python shim sync and async conversations preserve completed response attachments', { skip: pythonDependency }, () => { run(`
model = llm.get_model("fixture")
conversation = model.conversation()
first = conversation.prompt("before")
assert first.text() == "ok"
first.attachments = [llm.Attachment(path="/history.txt",type="text/plain")]
assert conversation.prompt("now").text() == "ok"
assert payloads[-1]["messages"][0] == {"role":"user","content":"before","attachments":[{"path":"/history.txt","mimeType":"text/plain"}]}
async_model = llm.get_async_model("fixture")
async def check():
 conversation = async_model.conversation()
 first = conversation.prompt("async-before")
 assert await first.text() == "ok"
 first.attachments = [llm.Attachment(path="/async-history.txt",type="text/plain")]
 assert await conversation.prompt("async-now").text() == "ok"
 assert payloads[-1]["messages"][0] == {"role":"user","content":"async-before","attachments":[{"path":"/async-history.txt","mimeType":"text/plain"}]}
asyncio.run(check())
`); });

test('valid calling programs match pinned LLM with deterministic model fixtures', {skip: !process.env.LLM_REFERENCE_PYTHON}, () => {
  const referenceSetup = `
import asyncio, json, llm
from importlib.metadata import version
from typing import Optional
assert version("llm") == "0.27.1"
payloads = []
def record(prompt, conversation):
 messages = []
 for response in conversation.responses if conversation is not None else []:
  item = {"role":"user","content":response.prompt.prompt}
  if response.attachments:
   item["attachments"] = [{"path":a.path,"mimeType":a.type} for a in response.attachments]
  messages.extend([item,{"role":"assistant","content":response.text_or_raise()}])
 payloads.append({"options":prompt.options.model_dump(exclude_none=True),"messages":messages})
class Model(llm.Model):
 model_id = "fixture"
 attachment_types = {"text/plain"}
 class Options(llm.Options):
  logit_bias: Optional[dict] = None
  stop: Optional[list] = None
 def execute(self, prompt, stream, response, conversation):
  record(prompt, conversation)
  yield "ok"
class AsyncModel(llm.AsyncModel):
 model_id = "fixture"
 attachment_types = {"text/plain"}
 Options = Model.Options
 async def execute(self, prompt, stream, response, conversation):
  record(prompt, conversation)
  yield "ok"
llm.get_model_aliases = lambda: {"fixture":Model()}
llm.get_async_model_aliases = lambda: {"fixture":AsyncModel()}
`;
  const program = `
model = llm.get_model("fixture")
assert model.prompt("hello", logit_bias={42:5}, stop=["end"]).text() == "ok"
conversation = model.conversation()
response = conversation.prompt("before")
assert response.text() == "ok"
response.attachments = [llm.Attachment(path="/history.txt", type="text/plain")]
assert conversation.prompt("now").text() == "ok"
async_model = llm.get_async_model("fixture")
async def check():
 conversation = async_model.conversation()
 response = conversation.prompt("async-before")
 assert await response.text() == "ok"
 response.attachments = [llm.Attachment(path="/async-history.txt", type="text/plain")]
 assert await conversation.prompt("async-now").text() == "ok"
asyncio.run(check())
print(json.dumps([{"options":p["options"],"messages":p["messages"]} for p in payloads],sort_keys=True))
`;
  const reference = spawnSync(process.env.LLM_REFERENCE_PYTHON!, ['-B','-c',referenceSetup + program], {encoding:'utf8',timeout:5000});
  assert.ifError(reference.error);
  assert.equal(reference.status, 0, reference.stdout + reference.stderr);
  assert.equal(run(program), reference.stdout);
});
