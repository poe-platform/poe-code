import assert from 'node:assert/strict';
import test from 'node:test';
import { createPythonLlmCapability } from '../../src/commands/python/llm-capability.js';
import { createLlmService } from '../../src/commands/llm/service.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';

for (const current of [false, true]) test(`Python preserves history attachments with current attachments=${current}`, async () => {
  const original = new MemoryFileSystem();
  await original.writeFile('/history.txt', new Uint8Array(20_000).fill(65));
  await original.writeFile('/current.txt', new Uint8Array([66]));
  let closed = 0, historical = 0, latest = 0;
  const fs = new Proxy(original, { get(target, property) {
    if (property === 'openReadFile') return async (...args: Parameters<typeof original.openReadFile>) => {
      const handle = await original.openReadFile(...args);
      return { ...handle, async close() { closed++; await handle.close(); } };
    };
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const service = createLlmService({ defaultModel: 'fixture', providers: [{ name: 'fixture', models: [{ id: 'fixture', capabilities: ['messages'], attachmentTypes: ['text/plain'] }],
    complete() { return assert.fail('history attachment must use source transport'); },
    async *completeSources(request) {
      const attachments = request.messages?.[0]?.attachments;
      assert.equal(attachments?.length, 1);
      for await (const chunk of attachments![0]!.source.bytes) { assert.ok(chunk.length <= 16384); historical += chunk.length; }
      for (const attachment of request.attachments) for await (const chunk of attachment.source.bytes) latest += chunk.length;
      yield 'ok';
    },
  }] });
  const capability = createPythonLlmCapability({ fs, cwd: '/' }, service, { maxInputBytes: 30_000, maxBufferedInputBytes: 512 });
  await capability.call!({ operation: 'complete', payload: { prompt: 'now', messages: [{ role: 'user', content: 'before', attachments: [{ path: '/history.txt' }] }], attachments: current ? [{ path: '/current.txt' }] : [] } }, { signal: new AbortController().signal });
  assert.equal(historical, 20_000);
  assert.equal(latest, current ? 1 : 0);
  assert.equal(closed, current ? 2 : 1);
});

test('Python history and current attachments share one total input budget', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/history.txt', new Uint8Array(600));
  await fs.writeFile('/current.txt', new Uint8Array(600));
  let calls = 0;
  const service = createLlmService({ defaultModel: 'fixture', providers: [{ name: 'fixture', models: [{ id: 'fixture', capabilities: ['messages'], attachmentTypes: ['text/plain'] }], async *complete() { calls++; yield 'wrong'; }, async *completeSources() { calls++; yield 'wrong'; } }] });
  const capability = createPythonLlmCapability({ fs, cwd: '/' }, service, { maxInputBytes: 1000, maxBufferedInputBytes: 512 });
  await assert.rejects(capability.call!({ operation: 'complete', payload: { messages: [{ role: 'user', content: 'before', attachments: [{ path: '/history.txt', mimeType: 'text/plain' }] }], attachments: [{ path: '/current.txt', mimeType: 'text/plain' }] } }, { signal: new AbortController().signal }), /input byte limit/);
  assert.equal(calls, 0);
});
