import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { installPythonLlmModule } from '../../src/commands/python/llm-module.js';

const testPython = process.env.LLM_TEST_PYTHON ?? process.env.LLM_REFERENCE_PYTHON ?? 'python3';
const pydanticAvailable = spawnSync(testPython, ['-B', '-c', 'import pydantic'], {timeout: 5000}).status === 0;
const pythonDependency = pydanticAvailable ? false : 'Requires Python with Pydantic 2; set LLM_TEST_PYTHON or LLM_REFERENCE_PYTHON';

const snippet = `
import llm
class BinaryEmbedding(llm.EmbeddingModel):
 model_id = "binary-custom"
 supports_text = False
 supports_binary = True
 batch_size = 2
 def embed_batch(self, items):
  for item in items:
   yield [float(len(item))]
binary_custom = BinaryEmbedding()
assert str(binary_custom) == "BinaryEmbedding: binary-custom"
assert repr(binary_custom) == "<BinaryEmbedding: binary-custom>"
assert binary_custom.embed(b"abc") == [3.0]
assert list(binary_custom.embed_multi([b"a", b"bc", b"def"])) == [[1.0], [2.0], [3.0]]
try:
 binary_custom.embed("text")
 raise AssertionError("binary-only custom model accepted text")
except ValueError as error:
 assert str(error) == "This model does not support text strings, only binary data"
custom_calls = []
class CustomModel(llm.Model):
 model_id = "custom"
 supports_schema = True
 def execute(self, prompt, stream, response, conversation):
  custom_calls.append(prompt.prompt)
  response.set_usage(input=2, output=3)
  yield prompt.prompt.upper()
custom = CustomModel()
from pydantic import ValidationError
assert issubclass(llm.Model.Options, llm.Options)
assert llm.Model.Options is not llm.Options
assert isinstance(custom.prompt("empty").prompt.options, llm.Options)
assert custom.prompt("empty").prompt.options.model_dump() == {}
try:
 custom.prompt("bad-option", unexpected=True)
 raise AssertionError("base options accepted extra fields")
except ValidationError as error:
 assert error.errors()[0]["type"] == "extra_forbidden"
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
assert isinstance(model.prompt("unused").prompt.options, llm.Options)
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

const legacySetup = `
import sys, json, asyncio, types
bundle = json.load(sys.stdin)
_safe_llm_source = bundle["source"]
exec(bundle["registration"])
del _safe_llm_source
assert "llm" not in sys.modules
calls = []
histories = []
embedding_calls = []
default_files = {}
class Bridge:
 async def call(self, operation, payload):
  if operation == "default_model":
   name = payload["filename"]
   if payload["action"] == "get":
    return default_files[name].strip() if name in default_files else None
   if payload["model"] is None:
    if name not in default_files:
     return {"missing": True}
    del default_files[name]
   else:
    default_files[name] = payload["model"]
   return None
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
# These fixtures characterize the legacy shim even when native llm is installed.
from importlib.machinery import ModuleSpec
from importlib.util import module_from_spec
legacy_loader = next(loader for loader in sys.meta_path if type(loader).__name__ == "_SafeLlmLoader")
legacy_spec = ModuleSpec("llm", legacy_loader, is_package=True)
legacy_module = module_from_spec(legacy_spec)
sys.modules["llm"] = legacy_module
legacy_loader.exec_module(legacy_module)
`;

test('legacy llm shim matches reference lazy sync and async response contracts', {skip: pythonDependency}, () => {
  const globals = new Map<string, unknown>();
  let source: unknown;
  let registration = '';
  installPythonLlmModule({ globals, runPython(value) {
    source = globals.get('_safe_llm_source');
    registration = value;
  } });
  const result = spawnSync(testPython, ['-B', '-c', legacySetup + snippet], {
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

test('legacy shim response API closes streams after early exit, errors and cancellation', {skip: pythonDependency}, () => {
  const program = legacySetup + `
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
  const result = spawnSync(testPython, ['-B', '-c', program], {
    input: JSON.stringify({ source, registration }), encoding: 'utf8', timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('legacy shim custom model Options use genuine Pydantic validation like the reference', {skip: !process.env.LLM_REFERENCE_PYTHON}, () => {
  const program = `
import llm
from pydantic import BaseModel, ValidationError
assert issubclass(llm.Options, BaseModel)
class TypedModel(llm.Model):
 model_id = "typed"
 class Options(llm.Options):
  temperature: float = 0.5
 def execute(self, prompt, stream, response, conversation):
  assert isinstance(prompt.options, self.Options)
  yield str(prompt.options.temperature)
model = TypedModel()
assert model.prompt("test", temperature="0.75").text() == "0.75"
assert model.prompt("test").text() == "0.5"
for options in [{"unknown": True}, {"temperature": "invalid"}]:
 try:
  model.prompt("test", **options)
  raise AssertionError("invalid options accepted")
 except ValidationError as error:
  assert error.errors()[0]["type"] in ("extra_forbidden", "float_parsing")
class TypedAsyncModel(llm.AsyncModel):
 model_id = "typed-async"
 Options = TypedModel.Options
 async def execute(self, prompt, stream, response, conversation):
  yield str(prompt.options.temperature)
async def check():
 assert await TypedAsyncModel().prompt("test", temperature="0.25").text() == "0.25"
asyncio.run(check())
`;
  const globals = new Map<string, unknown>();
  let source: unknown;
  let registration = '';
  installPythonLlmModule({ globals, runPython(value) {
    source = globals.get('_safe_llm_source');
    registration = value;
  } });
  const originalSetup = `import asyncio
import json, sys
bundle = json.load(sys.stdin)
_safe_llm_source = bundle["source"]
exec(bundle["registration"])
import llm
from importlib.metadata import version
from llm.models import Model, Response
from llm.templates import Template
assert version("llm") == "0.27.1"
assert Model is llm.Model and Response is llm.Response
assert Model.__module__ == Response.__module__ == "llm.models"
assert Template.__module__ == "llm.templates"
assert not llm.__spec__.origin.endswith("poe_llm.py")
`;
  for (const setup of [legacySetup, originalSetup]) {
    const catalog = setup === legacySetup ? `
import llm
from pydantic import ValidationError
model = llm.Model("test-model", metadata={"options": {
 "temperature": {"type": "number", "minimum": 0, "maximum": 2},
 "count": {"type": "integer", "minimum": 1},
 "enabled": {"type": "boolean"},
 "label": {"type": "string", "nullable": True}
}})
assert model.prompt("test").prompt.options.model_dump(exclude_none=True) == {}
for values in [{"temperature": 3}, {"count": 0}, {"temperature": None}, {"unknown": True}]:
 try:
  model.prompt("test", **values)
  raise AssertionError("invalid catalog options accepted")
 except ValidationError:
  pass
original_stream = Bridge.stream
def checked_stream(self, payload):
 assert payload["options"] == {"temperature": 0.5, "count": 2, "enabled": True}
 return original_stream(self, payload)
Bridge.stream = checked_stream
assert model.prompt("typed", temperature="0.5", count="2", enabled=True, label=None).text() == "hello"
` : '';
    const python = setup === legacySetup ? testPython : process.env.LLM_REFERENCE_PYTHON!;
    const result = spawnSync(python, ['-B', '-c', setup + program + catalog], {
      input: JSON.stringify({source, registration}), encoding: 'utf8', timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
});

test('legacy shim default helpers preserve named files, fallbacks and removal behavior', {skip: pythonDependency}, () => {
  const program = `
import llm
assert llm.DEFAULT_MODEL == "gpt-4o-mini"
assert llm.get_default_model() == llm.DEFAULT_MODEL
assert llm.get_default_model(default="fallback") == "fallback"
assert llm.get_default_embedding_model() is None
llm.set_default_model("  alias \\n")
llm.set_default_embedding_model("embedding")
llm.set_default_model("profile", filename="profile.txt")
assert llm.get_default_model() == "alias"
assert llm.get_default_embedding_model() == "embedding"
assert llm.get_default_model("profile.txt") == "profile"
llm.set_default_model(None)
assert llm.get_default_model(default=None) is None
assert llm.get_default_embedding_model() == "embedding"
llm.set_default_embedding_model(None)
assert llm.get_default_embedding_model() is None
try:
 llm.set_default_model(None)
 raise AssertionError("removing an absent default accepted None")
except TypeError:
 pass
try:
 llm.set_default_model(123)
 raise AssertionError("non-string default accepted")
except TypeError:
 pass
`;
  const globals = new Map<string, unknown>();
  let source: unknown;
  let registration = '';
  installPythonLlmModule({globals,runPython(value) {source=globals.get('_safe_llm_source');registration=value;}});
  const bundled = spawnSync(testPython, ['-B','-c',legacySetup + program], {
    input:JSON.stringify({source,registration}),encoding:'utf8',timeout:5000,
  });
  assert.ifError(bundled.error);
  assert.equal(bundled.status,0,bundled.stdout + bundled.stderr);
  if (process.env.LLM_REFERENCE_PYTHON) {
    const setup = `
import llm
class MemoryPath:
 files = {}
 def __init__(self, name=""):
  self.name = name
 def __truediv__(self, name):
  return MemoryPath(name)
 def exists(self):
  return self.name in self.files
 def read_text(self):
  return self.files[self.name]
 def write_text(self, text):
  if not isinstance(text, str):
   raise TypeError("data must be str")
  self.files[self.name] = text
 def unlink(self):
  del self.files[self.name]
llm.user_dir = lambda: MemoryPath()
`;
    const reference = spawnSync(process.env.LLM_REFERENCE_PYTHON,['-B','-c',setup + program], {encoding:'utf8',timeout:5000});
    assert.ifError(reference.error);
    assert.equal(reference.status,0,reference.stdout + reference.stderr);
  }
});

test('legacy shim alias records support discovery and case-insensitive matching', {skip: pythonDependency}, () => {
  const program = `
import llm
class Named(llm.Model):
 model_id = "primary"
 def execute(self, *args):
  yield ""
class AsyncNamed(llm.AsyncModel):
 model_id = "async-primary"
 async def execute(self, *args):
  yield ""
class Embedded(llm.EmbeddingModel):
 model_id = "embed-primary"
 def embed_batch(self, items):
  return iter([])
record = llm.ModelWithAliases(Named(), AsyncNamed(), {"short"})
assert record.matches("SHORT") and record.matches("PRIMARY")
assert record.matches("Named:") and record.matches("async-primary")
assert not record.matches("absent")
assert llm.ModelWithAliases(None, AsyncNamed(), []).matches("ASYNC")
assert not llm.ModelWithAliases(None, None, []).matches("")
embedding = llm.EmbeddingModelWithAliases(Embedded(), {"vector"})
assert embedding.matches("VECTOR") and embedding.matches("Embedded:")
assert not embedding.matches("absent")
`;
  const globals = new Map<string, unknown>();
  let source: unknown;
  let registration = '';
  installPythonLlmModule({globals, runPython(value) {source = globals.get('_safe_llm_source'); registration = value;}});
  const discovery = `
records = llm.get_models_with_aliases()
record = next(item for item in records if item.model.model_id == "test-model")
assert record.aliases == ["alias"]
assert record.async_model.model_id == "test-model"
assert record.matches("ALIAS")
embeddings = llm.get_embedding_models_with_aliases()
assert len(embeddings) == 1 and embeddings[0].aliases == ["embed-alias"]
assert embeddings[0].model.model_id == "embedding"
`;
  for (const [python, setup, extra] of [
    [testPython, legacySetup, discovery],
    ...(process.env.LLM_REFERENCE_PYTHON ? [[process.env.LLM_REFERENCE_PYTHON, '', '']] : []),
  ]) {
    const result = spawnSync(python!, ['-B', '-c', setup + program + extra], {
      input: setup === legacySetup ? JSON.stringify({source, registration}) : undefined, encoding: 'utf8', timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
});

test('legacy shim tools preserve schemas, calls, results and execution hooks', {skip: pythonDependency}, () => {
  const program = `
import llm, asyncio, hashlib, json
from pydantic import BaseModel
def add(a: int, b: int = 2):
 """Add two numbers."""
 return a + b
tool = llm.Tool.function(add)
assert tool.name == "add" and tool.description == "Add two numbers."
assert tool.input_schema == {"properties": {"a": {"type": "integer"}, "b": {"default": 2, "type": "integer"}}, "required": ["a"], "type": "object"}
assert tool.implementation(a=3) == 5
assert tool.hash() == hashlib.sha256(json.dumps({"name":"add","description":"Add two numbers.","input_schema":tool.input_schema}).encode()).hexdigest()
try:
 llm.Tool.function(lambda: None)
 raise AssertionError("unnamed lambda accepted")
except ValueError:
 pass
assert llm.Tool.function(lambda value: value, name="identity").name == "identity"
class Args(BaseModel):
 values: list[int]
assert llm.Tool("typed", input_schema=Args).input_schema == {"properties":{"values":{"items":{"type":"integer"},"type":"array"}},"required":["values"],"type":"object"}
class Box(llm.Toolbox):
 def __init__(self, prefix="item"):
  self.prefix = prefix
 def label(self, value: str):
  return self.prefix + value
 def prepare(self):
  self.prepared = True
 async def prepare_async(self):
  self.async_prepared = True
box = Box("x")
assert box._config == {"prefix":"x"}
assert [item.name for item in Box.method_tools()] == ["Box_label"]
box.add_tool(add)
assert [item.name for item in box.tools()] == ["Box_label","add"]
assert list(Box().tools())[0].implementation("a") == "itema"
attachment = llm.Attachment(type="text/plain", content=b"tool")
def attached():
 return llm.ToolOutput({"ok":True}, [attachment])
def broken():
 raise ValueError("broken")
class ToolModel(llm.Model):
 model_id = "tool-model"
 supports_tools = True
 def execute(self, prompt, stream, response, conversation):
  assert isinstance(prompt.tools[0], llm.Tool)
  for name, args in [("add",{"a":3}),("attached",{}),("broken",{}),("missing",{}),("Box_label",{"value":"a"})]:
   response.add_tool_call(llm.ToolCall(name,args,name+"-id"))
  yield "tools"
model = ToolModel()
response = model.prompt("go", tools=[add,attached,broken,box])
assert not response._done
assert [item.name for item in response.tool_calls()] == ["add","attached","broken","missing","Box_label"]
seen = []
results = response.execute_tool_calls(after_call=lambda tool, call, result: seen.append(result.name))
assert [item.output for item in results] == ["5", '{"ok": true}', "Error: broken", 'Error: tool "missing" does not exist', "xa"]
assert results[1].attachments == [attachment] and isinstance(results[2].exception, ValueError)
assert isinstance(results[3].exception, KeyError) and results[4].instance is box and box.prepared
assert seen == ["add","attached","broken","Box_label"]
assert results[0].tool_call_id == "add-id"
fresh_box = Box()
class PreparedModel(llm.Model):
 model_id = "prepared"
 supports_tools = True
 def execute(self, prompt, stream, response, conversation):
  assert fresh_box.prepared, "sync toolboxes must prepare before lazy execution"
  response.add_tool_call(llm.ToolCall("Box_label", {"value":"ready"}))
  yield ""
assert PreparedModel().prompt("go", tools=[fresh_box]).execute_tool_calls()[0].output == "itemready"
def cancel(tool, call):
 raise llm.CancelToolCall("stop")
assert all(item.output == "Cancelled: stop" for item in response.execute_tool_calls(before_call=cancel))
try:
 class NoTools(llm.Model):
  model_id = "no-tools"
  def execute(self, *args):
   yield ""
 NoTools().prompt("go",tools=[add])
 raise AssertionError("unsupported tools accepted")
except ValueError as error:
 assert str(error) == "NoTools: no-tools does not support tools"
async def async_add(a: int):
 await asyncio.sleep(0)
 return a + 1
class AsyncToolModel(llm.AsyncModel):
 model_id = "async-tools"
 supports_tools = True
 async def execute(self, prompt, stream, response, conversation):
  response.add_tool_call(llm.ToolCall("async_add", {"a":3}, "async-id"))
  response.add_tool_call(llm.ToolCall("Box_label", {"value":"b"}))
  yield "async"
async def check():
 response = AsyncToolModel().prompt("go", tools=[async_add,box])
 try:
  response.tool_calls_or_raise()
  raise AssertionError("unawaited tool calls accepted")
 except ValueError:
  pass
 seen = []
 async def after(tool, call, result):
  seen.append(result.output)
 results = await response.execute_tool_calls(after_call=after)
 assert [item.output for item in results] == ["4","xb"]
 assert sorted(seen) == ["4","xb"] and box.async_prepared
 assert response.tool_calls_or_raise()[0].tool_call_id == "async-id"
 assert (await response.to_sync_response()).tool_calls()[0].name == "async_add"
asyncio.run(check())
class ChainModel(llm.Model):
 model_id = "chain-model"
 supports_tools = True
 def execute(self, prompt, stream, response, conversation):
  assert conversation is not None
  if not prompt.tool_results:
   response.add_tool_call(llm.ToolCall("add", {"a":7}, "chain-id"))
   yield "calling:"
  else:
   assert prompt.tool_results[0].tool_call_id == "chain-id"
   yield prompt.tool_results[0].output
chain = ChainModel().chain("go", tools=[add])
assert chain._responses == []
assert chain.text() == "calling:9"
assert len(chain._responses) == 2 and len(chain.conversation.responses) == 2
conversation = ChainModel().conversation(tools=[add], chain_limit=1)
try:
 conversation.chain("go").text()
 raise AssertionError("chain limit ignored")
except ValueError as error:
 assert str(error) == "Chain limit of 1 exceeded."
class AsyncChainModel(llm.AsyncModel):
 model_id = "async-chain"
 supports_tools = True
 async def execute(self, prompt, stream, response, conversation):
  if not prompt.tool_results:
   response.add_tool_call(llm.ToolCall("async_add", {"a":8}))
   yield "calling:"
  else:
   yield prompt.tool_results[0].output
async def chain_check():
 chain = AsyncChainModel().chain("go", tools=[async_add])
 assert await chain.text() == "calling:9"
 assert len(chain._responses) == 2 and len(chain.conversation.responses) == 2
 closed = []
 started = asyncio.Event()
 async def waiting():
  started.set()
  try:
   await asyncio.Event().wait()
  finally:
   closed.append(True)
 class WaitingModel(llm.AsyncModel):
  model_id = "waiting-model"
  supports_tools = True
  async def execute(self, prompt, stream, response, conversation):
   response.add_tool_call(llm.ToolCall("waiting", {}))
   yield ""
 response = WaitingModel().prompt("go", tools=[waiting])
 task = asyncio.create_task(response.execute_tool_calls())
 await started.wait()
 task.cancel()
 try:
  await task
 except asyncio.CancelledError:
  pass
 assert closed == [True]
asyncio.run(chain_check())
`;
  const globals = new Map<string, unknown>();
  let source: unknown;
  let registration = '';
  installPythonLlmModule({globals,runPython(value) {source=globals.get('_safe_llm_source');registration=value;}});
  for (const [python, setup] of [
    [testPython, legacySetup],
    ...(process.env.LLM_REFERENCE_PYTHON ? [[process.env.LLM_REFERENCE_PYTHON, '']] : []),
  ]) {
    const result = spawnSync(python!, ['-B','-c',setup + program], {
      input:setup === legacySetup ? JSON.stringify({source,registration}) : undefined,encoding:'utf8',timeout:5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status,0,result.stdout+result.stderr);
  }
});

test('legacy shim templates, fragments and public submodule imports work without file installation', {skip: pythonDependency}, () => {
  const program = `
import llm, hashlib, string
from llm.models import Model, Tool, ToolCall, Options
from llm.templates import Template, AttachmentType
from llm.utils import Fragment, schema_dsl
from llm.errors import ModelError, NeedsKeyException
assert Model is llm.Model and Tool is llm.Tool and Options is llm.Options
assert ToolCall is llm.ToolCall and Template is llm.Template and Fragment is llm.Fragment
assert issubclass(NeedsKeyException, ModelError) and str(ModelError("test")) == "test"
fragment = Fragment("source text", source="notes.md")
assert isinstance(fragment, str) and fragment.source == "notes.md"
assert fragment.id() == hashlib.sha256(b"source text").hexdigest()
assert Fragment("text").source == ""
template = Template(name="review", prompt="Review $topic: $input", system="Role $role",
 defaults={"topic":"code","role":"reviewer"}, options={"temperature":0.5},
 attachment_types=[{"type":"text/plain","value":"notes.txt"}])
assert template.vars() == {"topic","input","role"}
assert template.evaluate("body") == ("Review code: body","Role reviewer")
params = {"topic":"tests"}
assert template.evaluate("body", params) == ("Review tests: body","Role reviewer")
assert params == {"topic":"tests","input":"body","role":"reviewer"}
assert template.attachment_types == [AttachmentType(type="text/plain",value="notes.txt")]
assert template._functions_is_trusted is False
assert template.model_dump()["name"] == "review"
assert Template(name="system",system="Role $input").evaluate("user") == ("user","Role user")
assert Template(name="empty",prompt="").evaluate("user") == ("user",None)
assert Template.interpolate(None,{}) is None
assert Template.interpolate("",{}) == ""
assert Template.interpolate("$$ $value",{"value":3}) == "$ 3"
assert Template.extract_vars(string.Template("$x $x $" + "{braced} $$")) == ["x","x"]
try:
 Template(name="missing",prompt="$value").evaluate("")
 raise AssertionError("missing template variable accepted")
except Template.MissingVariables as error:
 assert str(error) == "Missing variables: value"
from pydantic import ValidationError
for values in [{"name":"bad","extra":True},{"name":"bad","_functions_is_trusted":True}]:
 try:
  Template(**values)
  raise AssertionError("template accepted extra fields")
 except ValidationError:
  pass
`;
  const globals = new Map<string, unknown>();
  let source: unknown;
  let registration = '';
  installPythonLlmModule({globals,runPython(value) {source=globals.get('_safe_llm_source');registration=value;}});
  for (const [python, setup] of [
    [testPython, legacySetup],
    ...(process.env.LLM_REFERENCE_PYTHON ? [[process.env.LLM_REFERENCE_PYTHON, '']] : []),
  ]) {
    const result = spawnSync(python!, ['-B','-c',setup + program], {
      input:setup === legacySetup ? JSON.stringify({source,registration}) : undefined,
      encoding:'utf8',timeout:5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status,0,result.stdout+result.stderr);
  }
});
