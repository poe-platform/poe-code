import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { installPythonLlmModule } from '../../src/commands/python/llm-module.js';

const snippet = `
import llm
custom_calls = []
class CustomModel(llm.Model):
 model_id = "custom"
 supports_schema = True
 def execute(self, prompt, stream, response, conversation):
  custom_calls.append(prompt.prompt)
  response.set_usage(input=2, output=3)
  yield prompt.prompt.upper()
custom = CustomModel()
assert custom.supports_schema
custom_response = custom.prompt("custom")
assert custom_calls == []
assert list(custom_response) == ["CUSTOM"]
assert custom_response.text() == "CUSTOM"
assert custom_response.usage().input == 2
assert custom_calls == ["custom"]
class CustomAsyncModel(llm.AsyncModel):
 model_id = "custom-async"
 async def execute(self, prompt, stream, response, conversation):
  yield prompt.prompt.upper()
async def custom_async_check():
 response = CustomAsyncModel().prompt("async-custom")
 assert await response.text() == "ASYNC-CUSTOM"
asyncio.run(custom_async_check())
custom_conversation = custom.conversation()
assert custom_conversation.prompt("turn").text() == "TURN"
assert len(custom_conversation.responses) == 1
schema = {"type": "object", "properties": {"name": {"type": "string"}, "age": {"type": "integer", "description": "in years"}}, "required": ["name", "age"]}
assert llm.schema_dsl("name, age int: in years") == schema
assert llm.schema_dsl("name, age int: in years", multi=True) == {"type": "object", "properties": {"items": {"type": "array", "items": schema}}, "required": ["items"]}
model = llm.get_model("test-model")
assert llm.get_model("alias").model_id == "test-model"
assert llm.get_model().model_id == "test-model"
try:
 llm.get_model("missing")
 raise AssertionError("unknown model was accepted")
except llm.UnknownModelError as error:
 assert error.args == ("Unknown model: missing",)
assert model.attachment_types == {"text/plain"}
assert not model.supports_schema and not model.supports_tools
assert str(model) == "Model: test-model"
assert repr(model) == "<Model: test-model>"
for kwargs, message in [
 ({"schema": {"type": "object"}}, "Model: test-model does not support schemas"),
 ({"attachments": [llm.Attachment(type="image/png", content=b"x")]},
  "This model does not support attachments of type 'image/png', only text/plain"),
]:
 try:
  model.prompt("invalid", **kwargs)
  raise AssertionError("unsupported input was accepted")
 except ValueError as error:
  assert str(error) == message
response = model.prompt("hello", stream=True)
assert calls == [], "prompts must be lazy"
assert response.model.model_id == "test-model"
assert response.prompt.prompt == "hello"
callbacks = []
response.on_done(lambda r: callbacks.append(r.text()))
assert list(response) == ["hel", "lo"]
assert response.text() == "hello"
assert list(response) == ["hel", "lo"]
assert callbacks == ["hello"]
response.on_done(lambda r: callbacks.append(r.text()))
assert callbacks == ["hello", "hello"]
assert len(calls) == 1
assert model.prompt("second", stream=False).text() == "hello"
assert len(calls) == 2
async_model = llm.get_async_model("test-model")
assert str(async_model) == "AsyncModel (async): test-model"
assert async_model.attachment_types == {"text/plain"}
assert not async_model.supports_schema
async def check_async():
 model = async_model
 response = model.prompt("async")
 assert len(calls) == 2
 assert [chunk async for chunk in response] == ["hel", "lo"]
 assert await response.text() == "hello"
 assert [chunk async for chunk in response] == ["hel", "lo"]
 assert len(calls) == 3
asyncio.run(check_async())
histories.clear()
conversation = model.conversation()
first = conversation.prompt("first")
assert conversation.responses == []
assert first.conversation is conversation
assert len(first.id) == 26 and len(conversation.id) == 26
assert first.text() == "hello"
assert conversation.responses == [first]
assert first.text() == "hello"
assert conversation.responses == [first]
second = conversation.prompt("second")
assert second.text() == "hello"
assert conversation.responses == [first, second]
assert histories == [[], [("first", "hello")]]
import struct
assert llm.encode([1, -2.5, 0]) == struct.pack("<fff", 1, -2.5, 0)
assert llm.decode(llm.encode([1, -2.5, 0])) == (1.0, -2.5, 0.0)
assert llm.encode([]) == b"" and llm.decode(b"") == ()
try:
 llm.decode(b"x")
 raise AssertionError("invalid embedding encoding was accepted")
except struct.error:
 pass
assert llm.cosine_similarity([1, 0], [0, 1]) == 0.0
assert llm.cosine_similarity([1, 0], [-1, 0]) == -1.0
try:
 llm.cosine_similarity([0, 0], [1, 0])
 raise AssertionError("zero magnitude was accepted")
except ZeroDivisionError:
 pass
embedding = llm.get_embedding_model("embed-alias")
assert embedding.model_id == "embedding"
assert embedding.embed("one") == [3.0, 1.0]
batches = embedding.embed_multi(iter(["a", "bb", "ccc"]), batch_size=2)
assert embedding_calls == [["one"]], "embedding batches must be lazy"
assert list(batches) == [[1.0, 1.0], [2.0, 1.0], [3.0, 1.0]]
assert embedding_calls == [["one"], ["a", "bb"], ["ccc"]]
try:
 embedding.embed(b"binary")
 raise AssertionError("text model accepted binary input")
except ValueError as error:
 assert str(error) == "This model does not support binary data, only text strings"
attachment = llm.Attachment(type="text/plain", path="/work/note.txt")
assert attachment.type == "text/plain" and attachment.path == "/work/note.txt"
assert attachment.resolve_type() == "text/plain"
assert model.prompt("attached", attachments=[attachment]).text() == "hello"
content = llm.Attachment(type="text/plain", content=b"abc")
assert content.content_bytes() == b"abc"
assert model.prompt("inline", attachments=[content]).text() == "hello"
assert content.base64_content() == "YWJj"
assert content.id() == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
fragmented = model.prompt("  tail ", fragments=["first", "", " second "],
 system="  last  ", system_fragments=["  leading ", "   ", " trailing  "])
assert fragmented.prompt.prompt == "first" + chr(10) * 2 + " second " + chr(10) + "  tail "
assert fragmented.prompt.system == "leading" + chr(10) * 2 + "trailing" + chr(10) * 2 + "last"
assert fragmented.text() == "hello"
assert calls[-1] == "first" + chr(10) * 2 + " second " + chr(10) + "  tail "
empty = model.prompt()
assert empty.prompt.prompt == "" and empty.prompt.system == ""
attachments = [attachment]
retained = model.prompt("retained", attachments=attachments)
attachments.clear()
assert retained.prompt.attachments == [attachment]
from datetime import datetime, timezone
timed = model.prompt("timed", stream=False)
count = len(calls)
assert timed.token_usage() == "" and len(calls) == count
assert str(timed) == "hello"
assert timed.text_or_raise() == "hello"
assert isinstance(timed.duration_ms(), int) and timed.duration_ms() >= 0
assert datetime.fromisoformat(timed.datetime_utc()).tzinfo == timezone.utc
timed.set_usage(input=1000, output=2, details={"cached": 0})
assert timed.usage().input == 1000 and timed.usage().output == 2
assert timed.token_usage() == '1,000 input, 2 output, {"cached": 0}'
timed.set_resolved_model("resolved")
assert timed.resolved_model == "resolved"
async def check_awaitable():
 direct = async_model.prompt("direct-next")
 assert direct.__aiter__() is direct
 assert await direct.__anext__() == "hel"
 assert await direct.text() == "hello"
 assert direct.__aiter__() is direct
 assert await direct.__anext__() == "hel"
 assert await direct.__anext__() == "lo"
 try:
  await direct.__anext__()
  raise AssertionError("exhausted response yielded a chunk")
 except StopAsyncIteration:
  pass
 pending = async_model.prompt("awaited")
 try:
  pending.text_or_raise()
  raise AssertionError("Unawaited text was accepted")
 except ValueError as error:
  assert str(error) == "Response not yet awaited"
 assert await pending is pending
 assert pending.text_or_raise() == "hello"
 assert isinstance(await pending.duration_ms(), int)
 assert datetime.fromisoformat(await pending.datetime_utc()).tzinfo == timezone.utc
 converted = await pending.to_sync_response()
 assert isinstance(converted, llm.Response)
 assert converted.id == pending.id and converted.text() == "hello"
 assert list(converted) == ["hel", "lo"]
asyncio.run(check_awaitable())
print("reference response contract passed")
`;

const referenceSetup = `
import asyncio, llm
calls = []
histories = []
class Model(llm.Model):
 model_id = "test-model"
 attachment_types = {"text/plain"}
 def execute(self, prompt, stream, response, conversation):
  if conversation is not None:
   histories.append([(r.prompt.prompt, r.text()) for r in conversation.responses])
  calls.append(prompt.prompt)
  yield "hel"
  yield "lo"
class AsyncModel(llm.AsyncModel):
 model_id = "test-model"
 attachment_types = {"text/plain"}
 async def execute(self, prompt, stream, response, conversation):
  if conversation is not None:
   histories.append([(r.prompt.prompt, r.text()) for r in conversation.responses])
  calls.append(prompt.prompt)
  yield "hel"
  yield "lo"
llm.get_model_aliases = lambda: {"test-model": Model(), "alias": Model()}
llm.get_async_model_aliases = lambda: {"test-model": AsyncModel(), "alias": AsyncModel()}
llm.get_default_model = lambda: "test-model"
embedding_calls = []
class EmbeddingModel(llm.EmbeddingModel):
 model_id = "embedding"
 def embed_batch(self, items):
  items = list(items)
  embedding_calls.append(items)
  for item in items:
   yield [float(len(item)), 1.0]
llm.get_embedding_model_aliases = lambda: {"embedding": EmbeddingModel(), "embed-alias": EmbeddingModel()}

`;

const bundledSetup = `
import sys, json, asyncio, types
bundle = json.load(sys.stdin)
_safe_llm_source = bundle["source"]
exec(bundle["registration"])
del _safe_llm_source
assert "llm" not in sys.modules
calls = []
histories = []
embedding_calls = []
class Bridge:
 async def call(self, operation, payload):
  if operation == "schema_dsl":
   assert payload["schema"] == "name, age int: in years"
   schema = {"type": "object", "properties": {"name": {"type": "string"}, "age": {"type": "integer", "description": "in years"}}, "required": ["name", "age"]}
   return {"type": "object", "properties": {"items": {"type": "array", "items": schema}}, "required": ["items"]} if payload["multi"] else schema
  if operation == "resolve_model":
   return "test-model"
  if operation == "configuration":
   return {"default_model": "test-model", "aliases": {}, "model_options": {}}
  if operation == "models":
   return [{"id": "test-model", "aliases": ["alias"], "capabilities": ["complete", "stream"], "metadata": {"attachmentTypes": ["text/plain"]}}, {"id": "embedding", "aliases": ["embed-alias"], "capabilities": ["embed"]}]
  if operation == "embed":
   embedding_calls.append(payload["inputs"])
   return {"model": payload["model"], "vectors": [[float(len(item)), 1.0] for item in payload["inputs"]]}
  calls.append(payload["prompt"])
  return {"model": "test-model", "text": "hello"}
 def stream(self, payload):
  async def generate():
   messages = payload["messages"]
   histories.append([(messages[i]["content"], messages[i+1]["content"]) for i in range(0, len(messages), 2)])
   calls.append(payload["prompt"])
   yield {"type": "text", "text": "hel"}
   yield {"type": "text", "text": "lo"}
   yield {"type": "response", "response": {"model": "test-model", "text": "hello"}}
  return generate()
capability = types.ModuleType("_poe_llm_capability")
capability.bridge = Bridge()
sys.modules[capability.__name__] = capability
`;

test('bundled llm matches reference lazy sync and async response contracts', () => {
  const globals = new Map<string, unknown>();
  let source: unknown;
  let registration = '';
  installPythonLlmModule({ globals, runPython(value) {
    source = globals.get('_safe_llm_source');
    registration = value;
  } });
  const result = spawnSync('python3', ['-B', '-c', bundledSetup + snippet], {
    input: JSON.stringify({ source, registration }), encoding: 'utf8', timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  if (process.env.LLM_REFERENCE_PYTHON) {
    const reference = spawnSync(process.env.LLM_REFERENCE_PYTHON, ['-B', '-c', referenceSetup + snippet], {
      encoding: 'utf8', timeout: 5000,
    });
    assert.ifError(reference.error);
    assert.equal(reference.status, 0, reference.stdout + reference.stderr);
    assert.equal(result.stdout, reference.stdout);
  }
});

test('reference response API closes streams after early exit, errors and cancellation', () => {
  const program = bundledSetup + `
import llm
closed = []
class OwnedBridge(Bridge):
 def stream(self, payload):
  async def generate():
   try:
    yield {"type": "text", "text": "first"}
    if payload["prompt"] == "error":
     raise ValueError("provider failed")
    if payload["prompt"] == "cancel":
     entered.set()
     await asyncio.Event().wait()
    yield {"type": "text", "text": "second"}
   finally:
    closed.append(payload["prompt"])
  return generate()
capability.bridge = OwnedBridge()
response = llm.get_model("test-model").prompt("early")
iterator = iter(response)
assert next(iterator) == "first"
iterator.close()
assert closed == ["early"]
response = llm.get_model("test-model").prompt("error")
try:
 response.text()
 raise AssertionError("provider error was swallowed")
except ValueError as error:
 assert str(error) == "provider failed"
assert closed == ["early", "error"]
async_model = llm.get_async_model("test-model")
async def check():
 global entered
 entered = asyncio.Event()
 response = async_model.prompt("cancel")
 task = asyncio.create_task(response.text())
 await entered.wait()
 task.cancel()
 try:
  await task
 except asyncio.CancelledError:
  pass
 await response.aclose()
 assert closed == ["early", "error", "cancel"]
 response = async_model.prompt("async-early")
 assert await response.__anext__() == "first"
 await response.aclose()
 assert closed == ["early", "error", "cancel", "async-early"]
 custom_closed = []
 class Custom(llm.AsyncModel):
  model_id = "custom"
  async def execute(self, prompt, stream, response, conversation):
   try:
    yield "first"
    await asyncio.Future()
   finally:
    custom_closed.append(True)
 custom = Custom().prompt("custom")
 assert await custom.__anext__() == "first"
 await custom.aclose()
 assert custom_closed == [True]
 try:
  await response.__anext__()
  raise AssertionError("exhausted response yielded a chunk")
 except StopAsyncIteration:
  pass
asyncio.run(check())
`;
  const globals = new Map<string, unknown>();
  let source: unknown;
  let registration = '';
  installPythonLlmModule({ globals, runPython(value) {
    source = globals.get('_safe_llm_source');
    registration = value;
  } });
  const result = spawnSync('python3', ['-B', '-c', program], {
    input: JSON.stringify({ source, registration }), encoding: 'utf8', timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
