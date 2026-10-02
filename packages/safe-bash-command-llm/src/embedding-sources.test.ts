import assert from 'node:assert/strict';
import test from 'node:test';
import { createLlmService } from './service.js';
import type { LlmInputSource, LlmProvider } from './types.js';

function fixture(hook: NonNullable<LlmProvider['embedSources']>) {
  return createLlmService({ providers: [{ name: 'fixture', models: [{ id: 'embedding', aliases: ['e'], capabilities: ['embed'], options: { dimensions: { type: 'integer' } } }], complete() { throw Error('unexpected completion'); }, embedSources: hook }] });
}
function source(onDispose: () => void): LlmInputSource {
  return { bytes: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode('hello'); } }, async dispose() { onDispose(); } };
}
test('embedding sources remain lazy, resolve aliases and dispose shared leases once', async () => {
  let disposed = 0;
  const input = source(() => disposed++);
  const service = fixture(async request => {
    assert.equal(request.model, 'embedding');
    assert.equal(request.inputs[0], input);
    assert.deepEqual(request.options, { dimensions: 2 });
    assert.equal(disposed, 0);
    return { model: request.model, vectors: [[1, 2], [3, 4]] };
  });
  assert.deepEqual((await service.embedSources!({ model: 'e', inputs: [input, input], options: { dimensions: '2' }, signal: new AbortController().signal })).vectors, [[1, 2], [3, 4]]);
  assert.equal(disposed, 1);
});
test('embedding source rejection disposes leases without invoking provider', async () => {
  let disposed = 0;
  const service = fixture(async () => { throw Error('unexpected provider'); });
  await assert.rejects(service.embedSources!({ model: 'missing', inputs: [source(() => disposed++)], options: {}, signal: new AbortController().signal }), /Unknown model/);
  assert.equal(disposed, 1);
});
test('embedding source cancellation releases a stalled provider and all leases', async () => {
  let disposed = 0;
  const controller = new AbortController();
  const service = fixture(async () => { controller.abort(new Error('cancel embedding')); return new Promise(() => {}); });
  await assert.rejects(service.embedSources!({ model: 'e', inputs: [source(() => disposed++)], options: {}, signal: controller.signal }), /cancel embedding/);
  assert.equal(disposed, 1);
});
test('embedding source responses are checked before releasing leases', async () => {
  let disposed = 0;
  const service = fixture(async () => ({ model: 'embedding', vectors: [[Infinity]] }));
  await assert.rejects(service.embedSources!({ model: 'e', inputs: [source(() => disposed++)], options: {}, signal: new AbortController().signal }), /Invalid embedding response/);
  assert.equal(disposed, 1);
});

test('OpenAI embeddings stream split UTF-8 JSON with backpressure and wire quotas', async () => {
  const { createOpenAiProvider } = await import('./openai.js');
  let reads = 0, disposed = 0, responseDisposed = 0;
  const text = '\u0000"\\ café 🦄'.repeat(4096);
  const bytes = new TextEncoder().encode(text);
  const input = (): LlmInputSource => ({ bytes: { async *[Symbol.asyncIterator]() {
    for (let offset = 0; offset < bytes.length; offset += 127) { reads++; yield bytes.subarray(offset, offset + 127); }
  } }, async dispose() { disposed++; } });
  const provider = createOpenAiProvider({ apiKey: 'test-only', models: [{ id: 'embedding', endpoint: 'embeddings' }], transport: async request => {
    assert.equal(reads, 0);
    const decoder = new TextDecoder();
    let body = '';
    for await (const chunk of request.body!) { assert.ok(chunk.length <= 16384); body += decoder.decode(chunk, { stream: true }); }
    body += decoder.decode();
    assert.deepEqual(JSON.parse(body), { model: 'embedding', input: [text], dimensions: 2 });
    return { status: 200, statusText: 'OK', headers: [], body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode('{"data":[{"index":0,"embedding":[1,2]}]}'); } }, async dispose() { responseDisposed++; } };
  } });
  const service = createLlmService({ providers: [provider] });
  assert.deepEqual((await service.embedSources!({ model: 'embedding', inputs: [input()], options: { dimensions: 2 }, signal: new AbortController().signal })).vectors, [[1, 2]]);
  assert.ok(reads > 100);
  assert.equal(disposed, 1);
  assert.equal(responseDisposed, 1);
  const limited = createOpenAiProvider({ apiKey: 'test-only', models: [{ id: 'embedding', endpoint: 'embeddings' }], limits: { maxRequestBytes: 100 }, transport: async request => {
    for await (const chunk of request.body!) void chunk;
    throw Error('should exceed quota');
  } });
  await assert.rejects(createLlmService({ providers: [limited] }).embedSources!({ model: 'embedding', inputs: [input()], options: {}, signal: new AbortController().signal }), /Provider request byte limit exceeded/);
  assert.equal(disposed, 2);
});

test('pre-aborted embedding requests and invalid options clean up without reading', async () => {
  const controller = new AbortController();
  controller.abort(new Error('already cancelled'));
  const service = fixture(async () => { throw Error('unexpected provider'); });
  let disposed = 0;
  const input: LlmInputSource = { bytes: { [Symbol.asyncIterator]() { throw Error('unexpected read'); } }, async dispose() { disposed++; } };
  await assert.rejects(service.embedSources!({ model: 'e', inputs: [input], options: {}, signal: controller.signal }), /already cancelled/);
  await assert.rejects(service.embedSources!({ model: 'e', inputs: [input], options: { dimensions: 'wrong' }, signal: new AbortController().signal }), /dimensions/);
  assert.equal(disposed, 2);
});
test('embedding cleanup attempts every lease and preserves primary errors', async () => {
  let disposed = 0;
  const broken: LlmInputSource = { ...source(() => {}), async dispose() { disposed++; throw Error('cleanup'); } };
  const good = source(() => disposed++);
  const service = fixture(async () => ({ model: 'embedding', vectors: [[1], [2]] }));
  await assert.rejects(service.embedSources!({ model: 'e', inputs: [broken, good], options: {}, signal: new AbortController().signal }), /cleanup/);
  await assert.rejects(service.embedSources!({ model: 'missing', inputs: [broken, good], options: {}, signal: new AbortController().signal }), /Unknown model/);
  assert.equal(disposed, 4);
});
test('materialized embedding requests retain their OpenAI wire values', async () => {
  const { createOpenAiProvider } = await import('./openai.js');
  const provider = createOpenAiProvider({ apiKey: 'test-only', models: [{ id: 'embedding', endpoint: 'embeddings' }], transport: async request => {
    let body = '';
    for await (const chunk of request.body!) body += new TextDecoder().decode(chunk);
    assert.deepEqual(JSON.parse(body), { model: 'embedding', input: ['a', 'b'], user: 'example' });
    return { status: 200, statusText: 'OK', headers: [], body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode('{"data":[{"index":1,"embedding":[2]},{"index":0,"embedding":[1]}]}'); } }, async dispose() {} };
  } });
  assert.deepEqual((await createLlmService({ providers: [provider] }).embed({ model: 'embedding', inputs: ['a', 'b'], options: { user: 'example' }, signal: new AbortController().signal })).vectors, [[1], [2]]);
});
