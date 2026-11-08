import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeOpenAiChatRequest } from './providers/index.js';
import * as llm from './index.js';
import { toByteSource } from 'safe-bash-contracts';

function source(value: string | Uint8Array) { return { bytes: toByteSource(value), async dispose() {} }; }
function request() {
  return { model: 'fixture', prompt: source('hello\n🙂'), system: source('system'),
    messages: [{ role: 'assistant' as const, content: source('earlier') }],
    attachments: [{ mimeType: 'image/png', source: source(new Uint8Array([0, 1, 255])) }],
    options: { temperature: 0.5 }, signal: new AbortController().signal };
}

test('public chat serializer carries streamed context and admitted controls', async () => {
  assert.equal(llm.serializeOpenAiChatRequest, serializeOpenAiChatRequest);
  let text = '';
  const decoder = new TextDecoder();
  for await (const chunk of serializeOpenAiChatRequest(request(), Infinity)) {
    assert.ok(chunk.length <= 16384);
    text += decoder.decode(chunk, { stream: true });
  }
  assert.deepEqual(JSON.parse(text + decoder.decode()), {
    temperature: 0.5, model: 'fixture', stream: true, stream_options: { include_usage: true },
    messages: [{ role: 'system', content: 'system' }, { role: 'assistant', content: 'earlier' },
      { role: 'user', content: [{ type: 'text', text: 'hello\n🙂' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAH/' } }] }],
  });
});

test('public serializer validates wire budgets before acquiring input', async () => {
  const input = request();
  input.prompt.bytes = { [Symbol.asyncIterator]() { return assert.fail('read input before admission'); } };
  for (const limit of [-1, NaN, 0.5, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => serializeOpenAiChatRequest(input, limit), RangeError);
  }
  await assert.rejects(async () => {
    for await (const ignored of serializeOpenAiChatRequest(input, 0)) void ignored;
  }, /byte limit/);
  assert.throws(() => serializeOpenAiChatRequest({ ...input, options: { model: 'override' } }, Infinity), /controlled by the provider/);
});

test('public serializer cancels pending input without taking ownership of leases', async () => {
  const controller = new AbortController();
  let acquired!: () => void;
  const pending = new Promise<void>(resolve => { acquired = resolve; });
  let returned = 0, disposed = 0;
  const input = request();
  input.prompt = { bytes: { [Symbol.asyncIterator]() { return {
    next() { acquired(); return new Promise<IteratorResult<Uint8Array>>(() => undefined); },
    async return() { returned++; return { done: true as const, value: undefined }; },
  }; } }, async dispose() { disposed++; } };
  const consumption = (async () => {
    for await (const ignored of serializeOpenAiChatRequest({ ...input, signal: controller.signal }, Infinity)) void ignored;
  })();
  await pending;
  controller.abort(new Error('stop serialization'));
  await assert.rejects(consumption, { message: 'stop serialization' });
  assert.equal(returned, 1);
  assert.equal(disposed, 0);
});
