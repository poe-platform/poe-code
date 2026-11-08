import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { toByteSource } from 'safe-bash-contracts';
import { createLlmCommand } from './command.js';
test('CLI streams large retained attachments without whole-file reads', async () => {
const backing = new MemoryFileSystem();
await backing.writeFile('/image.png', new Uint8Array(16 * 1024 * 1024 + 7));
let wholeReads = 0, streamedCalls = 0;
const fs = new Proxy(backing, { get(target, key) {
  if (key === 'readFile') return async (path: string, options: unknown) => {
    if (path === '/image.png') { wholeReads++; throw new Error('attachment must use retained bounded reads'); }
    return target.readFile(path, options as never);
  };
  const value = Reflect.get(target, key);
  return typeof value === 'function' ? value.bind(target) : value;
} });
const errors: Uint8Array[] = [];
const command = createLlmCommand({ limits: {maxInputBytes:20 * 1024 * 1024,maxBufferedInputBytes:8 * 1024 * 1024}, defaultModel: 'fixture', providers: [{
  name: 'fixture', models: [{ id: 'fixture', attachmentTypes: ['image/png'] }],
  complete() { throw new Error('buffered provider must not run'); },
  async *completeSources(request) { streamedCalls++; for await (const bytes of request.attachments[0]!.source!.bytes) assert.ok(bytes.byteLength <= 16384); yield 'answer'; }
}] });
const result = await command.execute({ command: 'llm', args: ['hello', '--at', '/image.png', 'image/png'], cwd: '/', env: {}, fs,
  signal: new AbortController().signal, stdin: toByteSource(''), stdout: {async write() {}}, stderr: {async write(bytes) {errors.push(bytes.slice());}} });

assert.equal(result.exitCode, 0, 'qualified source provider must receive retained attachment input');

assert.equal(wholeReads, 0);
assert.equal(streamedCalls, 1);
});

for (const state of ['disposed', 'already consumed'] as const) {
  test(`CLI attachment probe prefix cannot be read when ${state}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile('/image.png', new Uint8Array([1, 2, 3]));
    let checked = false;
    const command = createLlmCommand({ defaultModel: 'fixture', providers: [{
      name: 'fixture', models: [{ id: 'fixture', attachmentTypes: ['image/png'] }],
      complete() { throw new Error('buffered provider must not run'); },
      async *completeSources(request) {
        const source = request.attachments[0]!.source;
        assert.ok(source);
        if (state === 'disposed') await source.dispose();
        else {
          const first = source.bytes[Symbol.asyncIterator]();
          assert.deepEqual([...(await first.next()).value!], [1, 2, 3]);
          await first.return?.();
        }
        await assert.rejects(source.bytes[Symbol.asyncIterator]().next(), /closed/);
        checked = true;
        yield 'answer';
      },
    }] });
    const result = await command.execute({ command: 'llm', args: ['hello', '--at', '/image.png', 'image/png'], cwd: '/', env: {}, fs,
      signal: new AbortController().signal, stdin: toByteSource(''), stdout: { async write() {} }, stderr: { async write() {} } });
    assert.equal(result.exitCode, 0);
    assert.equal(checked, true);
  });
}
