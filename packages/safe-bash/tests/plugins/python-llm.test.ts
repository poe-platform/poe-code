import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { installPythonLlmModule } from '../../src/commands/python/llm-module.js';

test('pure Python library preserves typed requests, customization and stream ownership', () => {
  const program = `
import sys, json, types, asyncio, unittest
bundle = json.load(sys.stdin)
_safe_llm_source = bundle['source']
exec(bundle['registration'])
del _safe_llm_source
assert 'poe_llm' not in sys.modules, 'Unrelated Python commands must not eagerly import the LLM library'
from poe_llm import Client, Message, Attachment, Request, Response, LlmError, LimitError

class FakeBridge:
 def __init__(self):
  self.calls = []
  self.closed = 0
  self.embedding_metadata = {'labels': ['owned']}
  self.fail = False
 async def call(self, operation, payload):
  self.calls.append((operation, payload))
  if self.fail:
   raise LlmError('invalid_option', 'Unsupported temperature')
  if operation == 'models':
   return [{'id': 'provider/model', 'aliases': ['small'], 'capabilities': ['complete', 'stream']}]
  if operation == 'embed':
   return {'model': payload['model'], 'vectors': [[1.0, 0.25]], 'usage': {'tokens': 2}, 'metadata': self.embedding_metadata}
  return {'model': payload['model'], 'text': 'answer', 'data': bytes([255, 0, 42]), 'usage': {'tokens': 3}, 'conversation': 'c1', 'metadata': {'done': True}}
 def stream(self, payload):
  self.calls.append(('stream', payload))
  async def chunks():
   try:
    yield {'type': 'text', 'text': 'a'}
    yield {'type': 'bytes', 'data': bytes([255, 0])}
    yield {'type': 'response', 'response': {'model': payload['model'], 'text': 'answer'}}
   finally:
    self.closed += 1
  return chunks()

class LibraryTests(unittest.IsolatedAsyncioTestCase):
 async def test_configuration_snapshot_is_typed_and_owned(self):
  from poe_llm import Configuration, CapabilityError
  stored = {'default_model':'small', 'aliases':{'small':'provider/model'}, 'model_options':{'provider/model':{'mode':'saved'}}}
  class ConfigBridge(FakeBridge):
   async def call(self, operation, payload):
    self.calls.append((operation,payload))
    if operation == 'configuration':
     return stored
    return await super().call(operation,payload)
  bridge = ConfigBridge()
  async with Client(bridge=bridge) as client:
   result = await client.configuration()
  self.assertIsInstance(result,Configuration)
  self.assertEqual(result.default_model,'small')
  self.assertEqual(result.aliases,{'small':'provider/model'})
  stored['aliases']['small'] = 'changed'
  stored['model_options']['provider/model']['mode'] = 'changed'
  self.assertEqual(result.aliases,{'small':'provider/model'})
  self.assertEqual(result.model_options,{'provider/model':{'mode':'saved'}})
  with self.assertRaises(CapabilityError):
   await client.configuration()

 async def test_embedding_metadata_is_preserved_and_owned(self):
  bridge = FakeBridge()
  async with Client(bridge=bridge, model='provider/model') as client:
   result = await client.embed(['input'])
  self.assertEqual(result.metadata, {'labels': ['owned']})
  bridge.embedding_metadata['labels'].append('host-change')
  self.assertEqual(result.metadata, {'labels': ['owned']})

 async def test_embedding_iterable_is_consumed_once_before_transport(self):
  bridge = FakeBridge()
  seen = []
  def inputs():
   seen.append('input')
   yield 'input'
  async with Client(bridge=bridge, model='provider/model') as client:
   result = await client.embed(inputs())
  self.assertEqual(seen, ['input'])
  self.assertEqual(bridge.calls[-1][1]['inputs'], ['input'])
  self.assertEqual(result.vectors, ((1.0, 0.25),))
 async def test_explicit_none_overrides_client_limit(self):
  bridge = FakeBridge()
  async with Client(bridge=bridge, model='provider/model', max_response_bytes=1) as client:
   with self.assertRaises(LimitError):
    await client.complete('hello')
   await client.complete('hello', max_response_bytes=None)
   self.assertIsNone(bridge.calls[-1][1]['max_response_bytes'])
   async with client.stream('hello', max_response_bytes=None) as stream:
    self.assertEqual(len([event async for event in stream]), 3)
 async def test_unlimited(self):
  from poe_llm import _limit, _check_size
  self.assertIsNone(_limit(None))
  self.assertIsNone(_limit(float('inf')))
  for limit in (None, float('inf')):
   async with Client(bridge=FakeBridge(), model='provider/model', max_response_bytes=limit) as client:
    self.assertIsNone(client._limit)
    await client.complete('hello')
  async with Client(bridge=FakeBridge()) as client:
   self.assertIsNone(client._limit)
  _check_size(Response.from_payload({'model': 'provider/model', 'text': 'x' * 8388609}), None)

 async def test_relative_attachments_follow_operation_context(self):
  from unittest.mock import patch
  attachment = Attachment('input.bin', 'application/octet-stream')
  bridge = FakeBridge()
  async with Client(bridge=bridge, model='provider/model') as client:
   with patch('os.getcwd', return_value='/guest'):
    await client.complete('hello', attachments=[attachment])
   self.assertEqual(bridge.calls[-1][1]['attachments'], [{'path':'/guest/input.bin','mimeType':'application/octet-stream'}])
   with patch('os.getcwd', return_value='/next'):
    async with client.stream('hello', attachments=[attachment]) as stream:
     self.assertEqual(len([event async for event in stream]),3)
   self.assertEqual(bridge.calls[-1][1]['attachments'], [{'path':'/next/input.bin','mimeType':'application/octet-stream'}])
  self.assertEqual(Attachment('/absolute/input.bin').payload(), {'path':'/absolute/input.bin'})

 async def test_typed_customization_and_composition(self):
  bridge = FakeBridge()
  def transform(request):
   from dataclasses import replace
   return replace(request, prompt='prefix: ' + request.prompt)
  async with Client(bridge=bridge, model='provider/model', options={'temperature': 0.25, 'cache': True}, request_transform=transform, response_transform=lambda response: response.text.upper()) as client:
   self.assertEqual((await client.models())[0].id, 'provider/model')
   answer = await client.complete('hello', system='brief', messages=[Message('user', 'previous')], attachments=[Attachment('/work/input.bin', 'application/octet-stream')], options={'seed': 42}, schema={'type': 'object'}, template='summary', parameters={'topic': 'x'})
   self.assertEqual(answer, 'ANSWER')
   payload = bridge.calls[-1][1]
   self.assertEqual(payload['options'], {'temperature': 0.25, 'cache': True, 'seed': 42})
   self.assertEqual(payload['prompt'], 'prefix: hello')
   self.assertEqual(payload['messages'], [{'role': 'user', 'content': 'previous'}])
   self.assertEqual(payload['attachments'], [{'path': '/work/input.bin', 'mimeType': 'application/octet-stream'}])
   self.assertEqual(payload['schema'], {'type': 'object'})
   self.assertEqual(payload['template'], 'summary')
   self.assertEqual(payload['parameters'], {'topic': 'x'})
   prompt = client.prompt(lambda topic: 'Explain ' + topic, system='teacher')
   self.assertEqual(await prompt('gravity'), 'ANSWER')
   child = client.with_defaults(options={'seed': 5})
   self.assertEqual(await child.complete('child'), 'ANSWER')
   self.assertEqual(bridge.calls[-1][1]['options']['temperature'], 0.25)
  with self.assertRaises(LlmError):
   await client.complete('retired')

 async def test_integer_options_do_not_silently_lose_precision_in_javascript(self):
  bridge = FakeBridge()
  async with Client(bridge=bridge) as client:
   with self.assertRaises(ValueError):
    await client.complete('hello', options={'seed': 9007199254740993})
   self.assertEqual(bridge.calls, [])

 async def test_response_embedding_and_conversation(self):
  bridge = FakeBridge()
  async with Client(bridge=bridge, model='provider/model') as client:
   response = await client.complete('hello')
   self.assertIsInstance(response, Response)
   self.assertEqual(response.data, bytes([255, 0, 42]))
   self.assertEqual(response.usage, {'tokens': 3})
   self.assertEqual(response.metadata, {'done': True})
   embeddings = await client.embed(['hello'], options={'dimensions': 2})
   self.assertEqual(embeddings.vectors, ((1.0, 0.25),))
   conversation = client.conversation(system='be helpful')
   await conversation.complete('first')
   await conversation.complete('second')
   self.assertEqual(bridge.calls[-1][1]['messages'], [{'role': 'user', 'content': 'first'}, {'role': 'assistant', 'content': 'answer'}])
   self.assertEqual(bridge.calls[-1][1]['conversation'], 'c1')

 async def test_stream_early_exit_and_complete_events(self):
  bridge = FakeBridge()
  async with Client(bridge=bridge, model='provider/model') as client:
   async with client.stream('hello') as stream:
    async for event in stream:
     self.assertEqual(event.text, 'a')
     break
   self.assertEqual(bridge.closed, 1)
   async with client.stream('all') as stream:
    events = [event async for event in stream]
    self.assertEqual(events[1].data, bytes([255, 0]))
    self.assertEqual(stream.response.model, 'provider/model')
   self.assertEqual(bridge.closed, 2)

 async def test_errors_limits_and_cleanup(self):
  bridge = FakeBridge()
  client = Client(bridge=bridge, model='provider/model', max_response_bytes=1)
  with self.assertRaises(LimitError):
   await client.complete('hello')
  async with client.stream('hello') as stream:
   await stream.__anext__()
   with self.assertRaises(LimitError):
    await stream.__anext__()
  self.assertEqual(bridge.closed, 1)
  bridge.fail = True
  with self.assertRaises(LlmError) as failure:
   await client.complete('bad')
  self.assertEqual(failure.exception.code, 'invalid_option')
  await client.aclose()
  await client.aclose()

 async def test_client_cleanup_owns_open_streams(self):
  bridge = FakeBridge()
  client = Client(bridge=bridge, model='provider/model')
  stream = client.stream('hello')
  await stream.__anext__()
  await client.aclose()
  self.assertEqual(bridge.closed, 1)
  with self.assertRaises(StopAsyncIteration):
   await stream.__anext__()

 async def test_invalid_option_types_fail_before_transport(self):
  bridge = FakeBridge()
  client = Client(bridge=bridge, model='provider/model')
  for value in [object(), float('nan'), {'nested': 1}]:
   with self.assertRaises((TypeError, ValueError)):
    await client.complete('hello', options={'bad': value})
  self.assertEqual(bridge.calls, [])

 async def test_import_without_host_has_no_ambient_capability(self):
  from poe_llm import CapabilityError
  with self.assertRaises(CapabilityError):
   Client()

 async def test_client_cancels_a_pending_stream_before_closing_iterator(self):
  entered = asyncio.Event()
  cleaned = asyncio.Event()
  class DelayedBridge(FakeBridge):
   def stream(self, payload):
    async def chunks():
     try:
      entered.set()
      await asyncio.sleep(3600)
      yield {'type': 'text', 'text': 'late'}
     finally:
      cleaned.set()
    return chunks()
  client = Client(bridge=DelayedBridge(), model='provider/model')
  stream = client.stream('hello')
  reading = asyncio.create_task(stream.__anext__())
  await entered.wait()
  await client.aclose()
  self.assertTrue(cleaned.is_set())
  with self.assertRaises(asyncio.CancelledError):
   await reading

 async def test_cancellation_and_timeout_release_host_iterator(self):
  entered = asyncio.Event()
  bridge = FakeBridge()
  original = bridge.stream
  def delayed(payload):
   async def chunks():
    try:
     entered.set()
     await asyncio.sleep(3600)
     yield {'type': 'text', 'text': 'late'}
    finally:
     bridge.closed += 1
   return chunks()
  bridge.stream = delayed
  async with Client(bridge=bridge, model='provider/model') as client:
   async with client.stream('hello') as stream:
    reading = asyncio.create_task(stream.__anext__())
    await entered.wait()
    reading.cancel()
    with self.assertRaises(asyncio.CancelledError):
     await reading
   self.assertEqual(bridge.closed, 1)
   async with client.stream('timeout', timeout=0.01) as stream:
    with self.assertRaises(asyncio.TimeoutError):
     await stream.__anext__()
   self.assertEqual(bridge.closed, 2)

 async def test_invalid_limits_never_call_provider(self):
  bridge = FakeBridge()
  client = Client(bridge=bridge)
  with self.assertRaises(ValueError):
   await client.complete('hello', max_response_bytes=0)
  self.assertEqual(bridge.calls, [])

 async def test_closing_during_stream_transform_prevents_late_host_acquisition(self):
  entered = asyncio.Event()
  finished = asyncio.Event()
  async def transform(request):
   try:
    entered.set()
    await asyncio.sleep(3600)
    return request
   finally:
    finished.set()
  bridge = FakeBridge()
  client = Client(bridge=bridge, request_transform=transform)
  reading = asyncio.create_task(client.stream('hello').__anext__())
  await entered.wait()
  await client.aclose()
  self.assertTrue(finished.is_set())
  with self.assertRaises(asyncio.CancelledError):
   await reading
  self.assertEqual(bridge.calls, [])

 async def test_completion_transforms_are_owned_until_finished(self):
  for phase in ('request', 'response'):
   entered, finished = asyncio.Event(), asyncio.Event()
   async def transform(value):
    try:
     entered.set()
     await asyncio.sleep(3600)
     return value
    finally:
     finished.set()
   bridge = FakeBridge()
   client = Client(bridge=bridge, model='provider/model', **{phase + '_transform': transform})
   calling = asyncio.create_task(client.complete('hello'))
   try:
    await entered.wait()
    await client.aclose()
    self.assertTrue(finished.is_set(), phase)
    with self.assertRaises(asyncio.CancelledError):
     await calling
    self.assertEqual(len(bridge.calls), 0 if phase == 'request' else 1)
   finally:
    calling.cancel()
    await asyncio.gather(calling, return_exceptions=True)

 async def test_completion_timeout_includes_request_transformation(self):
  finished = asyncio.Event()
  async def transform(request):
   try:
    await asyncio.sleep(3600)
    return request
   finally:
    finished.set()
  bridge = FakeBridge()
  async with Client(bridge=bridge, request_transform=transform) as client:
   calling = asyncio.create_task(client.complete('hello', timeout=0.01))
   try:
    completed, pending = await asyncio.wait({calling}, timeout=1.0)
    self.assertIn(calling, completed, 'Timeout must include customization work')
    with self.assertRaises(asyncio.TimeoutError):
     await calling
    self.assertTrue(finished.is_set())
    self.assertEqual(bridge.calls, [])
   finally:
    calling.cancel()
    await asyncio.gather(calling, return_exceptions=True)

unittest.main(argv=['python-llm'], verbosity=2)
`;
  const globals = new Map<string, unknown>();
  let source: unknown;
  let registration = '';
  installPythonLlmModule({ globals, runPython(value) {
    source = globals.get('_safe_llm_source');
    registration = value;
  } });
  assert.equal(globals.has('_safe_llm_source'), false);
  const result = spawnSync('python3', ['-B', '-c', program], {
    input: JSON.stringify({ source, registration }), encoding: 'utf8', timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});


