import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { pythonLlmProvider } from '../../src/commands/python/llm-provider.js';

const setup = `
import json, sys, types
from contextlib import contextmanager
from importlib.metadata import version
import llm
assert version("llm") == "0.27.1"
payloads = []
inputs = {}
closed = []
class HostError(Exception): pass
def call(service, request):
 operation, payload = request["operation"], request["payload"]
 if operation == "input_open":
  handle = str(len(inputs)); inputs[handle] = bytearray(); return handle
 if operation == "input_write": inputs[payload["id"]].extend(payload["bytes"]); return None
 if operation == "input_close": closed.append(payload["id"]); return None
 raise AssertionError(operation)
@contextmanager
def stream(service, payload):
 payloads.append(payload)
 yield iter([{"type":"text", "text":"ok"}])
sys.modules["safe_host"] = types.SimpleNamespace(call=call, stream=stream, HostError=HostError)
provider = types.ModuleType("fixture_provider")
exec(json.load(sys.stdin), provider.__dict__)
entry = {"id":"fixture", "capabilities":[], "metadata":{"attachmentTypes":["text/plain"], "options":{}}}
`;

function run(program: string): void {
  const result = spawnSync(process.env.LLM_TEST_PYTHON ?? process.env.LLM_REFERENCE_PYTHON ?? 'python3', ['-B', '-c', setup + program], {
    input: JSON.stringify(pythonLlmProvider), encoding: 'utf8', timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

test('genuine provider admits declared structured options and rejects wrong types before dispatch', () => run(`
entry["metadata"]["options"] = {"bias":{"type":"object"}, "stop":{"type":"array"}}
model = provider.HostModel(entry)
assert model.prompt("hello", bias={"42":5}, stop=["end"]).text() == "ok"
assert payloads[-1]["options"] == {"bias":{"42":5},"stop":["end"]}
from pydantic import ValidationError
for options in [{"bias":[]}, {"stop":{}}, {"unknown":True}]:
 before = len(payloads)
 try:
  model.prompt("invalid", **options).text()
  raise AssertionError("invalid options accepted")
 except ValidationError: pass
 assert len(payloads) == before
`));

test('genuine provider retains history attachments and retires each invocation spool', () => run(`
model = provider.HostModel(entry)
conversation = model.conversation()
attachment = llm.Attachment(content=b"original", type="text/plain")
assert conversation.prompt("before", attachments=[attachment]).text() == "ok"
assert conversation.prompt("now").text() == "ok"
message = payloads[-1]["messages"][0]
assert message["role"] == "user" and message["content"] == "before"
source = message["attachments"][0]
assert source["mimeType"] == "text/plain"
assert bytes(inputs[source["spool"]]) == b"original"
assert closed == list(inputs)
assert attachment.content == b"original"
`));

test('genuine async provider preserves structured options and historical attachment content', () => run(`
import asyncio
class Bridge:
 async def stream(self, payload):
  payloads.append(payload)
  yield {"type":"text", "text":"ok"}
sys.modules["_poe_llm_capability"] = types.SimpleNamespace(bridge=Bridge())
sys.modules["poe_llm"] = types.SimpleNamespace(LlmError=HostError)
entry["metadata"]["options"] = {"stop":{"type":"array"}}
async def check():
 conversation = provider.HostAsyncModel(entry).conversation()
 assert await conversation.prompt("before", attachments=[llm.Attachment(content=b"async", type="text/plain")]).text() == "ok"
 assert await conversation.prompt("now", stop=["end"]).text() == "ok"
 assert payloads[-1]["options"] == {"stop":["end"]}
 source = payloads[-1]["messages"][0]["attachments"][0]
 assert bytes(inputs[source["spool"]]) == b"async"
 assert closed == list(inputs)
asyncio.run(check())
`));

test('genuine provider retires staged historical attachments when a later source fails', () => run(`
model = provider.HostModel(entry)
conversation = model.conversation()
assert conversation.prompt("before", attachments=[llm.Attachment(content=b"history", type="text/plain")]).text() == "ok"
before = len(payloads)
try:
 conversation.prompt("now", attachments=[llm.Attachment(type="text/plain")]).text()
 raise AssertionError("missing attachment source accepted")
except llm.ModelError as error:
 assert str(error) == "Attachment requires a path, URL or content"
assert len(payloads) == before
assert len(inputs) == 2 and closed == list(inputs)
`));

test('genuine provider forwards attachments restored on completed responses', () => run(`
model = provider.HostModel(entry)
conversation = model.conversation()
previous = conversation.prompt("restored")
assert previous.text() == "ok"
previous.attachments = [llm.Attachment(content=b"persisted", type="text/plain")]
assert previous.prompt.attachments == []
assert conversation.prompt("continue").text() == "ok"
source = payloads[-1]["messages"][0]["attachments"][0]
assert bytes(inputs[source["spool"]]) == b"persisted"
assert closed == list(inputs)
`));
