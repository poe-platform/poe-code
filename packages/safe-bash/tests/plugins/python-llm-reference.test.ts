import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { installPythonLlmModule } from '../../src/commands/python/llm-module.js';

const snippet = `
import llm
model = llm.get_model("test-model")
assert llm.get_model("alias").model_id == "test-model"
assert llm.get_model().model_id == "test-model"
try:
 llm.get_model("missing")
 raise AssertionError("unknown model was accepted")
except llm.UnknownModelError as error:
 assert error.args == ("Unknown model: missing",)
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
async def check_async():
 model = async_model
 response = model.prompt("async")
 assert len(calls) == 2
 assert [chunk async for chunk in response] == ["hel", "lo"]
 assert await response.text() == "hello"
 assert [chunk async for chunk in response] == ["hel", "lo"]
 assert len(calls) == 3
asyncio.run(check_async())
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
print("reference response contract passed")
`;

const referenceSetup = `
import asyncio, llm
calls = []
class Model(llm.Model):
 model_id = "test-model"
 def execute(self, prompt, stream, response, conversation):
  calls.append(prompt.prompt)
  yield "hel"
  yield "lo"
class AsyncModel(llm.AsyncModel):
 model_id = "test-model"
 async def execute(self, prompt, stream, response, conversation):
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
embedding_calls = []
class Bridge:
 async def call(self, operation, payload):
  if operation == "resolve_model":
   return "test-model"
  if operation == "configuration":
   return {"default_model": "test-model", "aliases": {}, "model_options": {}}
  if operation == "models":
   return [{"id": "test-model", "aliases": ["alias"], "capabilities": ["complete", "stream"]}, {"id": "embedding", "aliases": ["embed-alias"], "capabilities": ["embed"]}]
  if operation == "embed":
   embedding_calls.append(payload["inputs"])
   return {"model": payload["model"], "vectors": [[float(len(item)), 1.0] for item in payload["inputs"]]}
  calls.append(payload["prompt"])
  return {"model": "test-model", "text": "hello"}
 def stream(self, payload):
  async def generate():
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
