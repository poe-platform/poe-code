import assert from 'node:assert/strict';
import test from 'node:test';
import { createLlmService } from './service.js';
import type { LlmRequest, LlmResponseMetadata } from './types.js';

const signal = new AbortController().signal;
const input = { prompt: 'hello', attachments: [], options: {}, signal };

test('shared service preserves typed options and conversations and reports provider metadata', async () => {
  let received: LlmRequest | undefined;
  const service = createLlmService({ defaultModel: 'alias', providers: [{
    name: 'test', models: [{ id: 'chat', aliases: ['alias'], capabilities: ['messages', 'schema'] }],
    async *complete(request) { received = request; yield 'answer'; return { usage: { input: 3 }, metadata: { id: 'response-1' } }; },
  }] });
  const events = [];
  for await (const event of service.stream({ ...input, messages: [{ role: 'assistant', content: 'previous' }], schema: { type: 'object' }, options: { temperature: 0.5, store: false } })) events.push(event);
  assert.equal(service.version, 1);
  assert.equal(received?.model, 'chat');
  assert.deepEqual(received?.options, { temperature: 0.5, store: false });
  assert.deepEqual(received?.messages, [{ role: 'assistant', content: 'previous' }]);
  assert.deepEqual(events, [{ type: 'text', text: 'answer' }, { type: 'response', response: { model: 'chat', usage: { input: 3 }, metadata: { id: 'response-1' } } }]);
});

test('shared service rejects unsupported rich features before calling a provider', async () => {
  let calls = 0;
  const service = createLlmService({ defaultModel: 'chat', providers: [{ name: 'test', models: [{ id: 'chat' }], async *complete() { calls++; yield 'wrong'; } }] });
  for (const fields of [{ messages: [{ role: 'user', content: 'x' }] }, { schema: { type: 'object' } }, { options: { bad: NaN } }] as const) {
    await assert.rejects(async () => { for await (const ignoredEvent of service.stream({ ...input, ...fields })) { /* consume */ } });
  }
  assert.equal(calls, 0);
});

test('embeddings dispatch canonical model identities and validate vector counts and finite values', async () => {
  let bad = false;
  const service = createLlmService({ defaultModel: 'embed', providers: [{ name: 'test', models: [{ id: 'embed', capabilities: ['embed'] }], async *complete() {}, async embed(request) {
    assert.equal(request.model, 'embed');
    return { model: request.model, vectors: bad ? [[NaN]] : request.inputs.map(() => [1, 2]), usage: { input: 1 } };
  } }] });
  assert.deepEqual(await service.embed({ inputs: ['x'], options: {}, signal }), { model: 'embed', vectors: [[1, 2]], usage: { input: 1 } });
  bad = true;
  await assert.rejects(service.embed({ inputs: ['x'], options: {}, signal }), /embedding response/i);
});

test('streaming closes provider on early return and enforces output limits without collecting output', async () => {
  let closed = false;
  const service = createLlmService({ defaultModel: 'chat', providers: [{ name: 'test', models: [{ id: 'chat' }], async *complete() { try { yield 'abc'; yield 'def'; } finally { closed = true; } } }] });
  for await (const ignoredEvent of service.stream(input)) break;
  assert.equal(closed, true);
  closed = false;
  await assert.rejects(async () => { for await (const ignoredEvent of service.stream({ ...input, maxOutputBytes: 4 })) { /* consume */ } }, /output.*limit/i);
  assert.equal(closed, true);
});

test('stream cancellation settles a stalled read and preserves abort reason', async () => {
  const controller = new AbortController();
  const reason = new Error('cancelled');
  let released = false;
  const service = createLlmService({ defaultModel: 'chat', providers: [{ name: 'test', models: [{ id: 'chat' }], complete() {
    return { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<string>>(() => {}), async return() { released = true; return { done: true as const, value: undefined }; } }; } };
  } }] });
  const iterator = service.stream({ ...input, signal: controller.signal })[Symbol.asyncIterator]();
  const next = iterator.next();
  controller.abort(reason);
  await assert.rejects(next, error => error === reason);
  assert.equal(released, true);
});

test('embedding cancellation settles uncooperative providers and preserves abort reason', async () => {
  const controller = new AbortController();
  const reason = new Error('cancelled embeddings');
  const service = createLlmService({ defaultModel: 'embed', providers: [{
    name: 'test', models: [{ id: 'embed', capabilities: ['embed'] }], async *complete() {},
    embed: () => new Promise(() => {}),
  }] });
  const pending = service.embed({ inputs: ['x'], options: {}, signal: controller.signal });
  controller.abort(reason);
  const outcome = await Promise.race([
    pending.then(() => 'fulfilled', error => error),
    new Promise(resolve => setTimeout(() => resolve('still pending'), 25)),
  ]);
  assert.equal(outcome, reason);
});

test('embedding validation rejects sparse input and output arrays before exposing results', async () => {
  let calls = 0;
  let vectors: readonly (readonly number[])[] = [[1]];
  const service = createLlmService({ defaultModel: 'embed', providers: [{
    name: 'test', models: [{ id: 'embed', capabilities: ['embed'] }], async *complete() {},
    async embed(request) { calls++; return { model: request.model, vectors }; },
  }] });
  await assert.rejects(service.embed({ inputs: new Array<string>(1), options: {}, signal }), /input/i);
  assert.equal(calls, 0);
  vectors = new Array<number[]>(1);
  await assert.rejects(service.embed({ inputs: ['x'], options: {}, signal }), /embedding response/i);
  vectors = [new Array<number>(1)];
  await assert.rejects(service.embed({ inputs: ['x'], options: {}, signal }), /embedding response/i);
});

test('stream metadata rejects malformed usage and metadata fields', async () => {
  for (const details of [{ usage: 'invalid' }, { usage: [] }, { metadata: true }, { metadata: [] }]) {
    const service = createLlmService({ defaultModel: 'chat', providers: [{
      name: 'test', models: [{ id: 'chat' }], async *complete() { yield 'answer'; return details as unknown as LlmResponseMetadata; },
    }] });
    await assert.rejects(async () => { for await (const ignoredEvent of service.stream(input)) { /* consume */ } }, /metadata/i);
  }
});

test('byte events retain owned chunks when a provider reuses its buffer', async () => {
  const buffer = new Uint8Array([0, 255]);
  const service = createLlmService({ defaultModel: 'binary', providers: [{
    name: 'test', models: [{ id: 'binary', outputType: 'application/octet-stream' }],
    async *complete() { yield buffer; buffer.fill(1); yield buffer; },
  }] });
  const events = [];
  for await (const event of service.stream({ ...input, maxOutputBytes: 4 })) events.push(event);
  assert.deepEqual(events, [
    { type: 'bytes', data: new Uint8Array([0, 255]) },
    { type: 'bytes', data: new Uint8Array([1, 1]) },
    { type: 'response', response: { model: 'binary' } },
  ]);
});
