import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { resolveLlmSchemaInput } from './schema-input.js';

test('schema file admission rejects oversize controls before reading and always closes retained reads', async () => {
  const backing = new MemoryFileSystem();
  const bytes = new TextEncoder().encode(JSON.stringify({type: 'object', description: 'x'.repeat(40000)}));
  await backing.writeFile('/schema', bytes);
  let opens = 0, closes = 0, largest = 0;
  const fs = new Proxy(backing, {get(target, key) {
    if (key === 'openReadFile') return async (...args: Parameters<typeof target.openReadFile>) => {
      opens++;
      const handle = await target.openReadFile(...args);
      return {stat: handle.stat.bind(handle), async read(offset: number, length: number, options: Parameters<typeof handle.read>[2]) {largest = Math.max(largest, length); return handle.read(offset, length, options);}, async close() {closes++; await handle.close();}};
    };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  }});
  const context = {fs, cwd: '/', signal: new AbortController().signal};
  const options = {loadTemplate: async () => ({name: 'empty'})};
  await assert.rejects(resolveLlmSchemaInput(context, '/schema', {...options, maxBytes: 8}), /byte limit/);
  assert.equal(opens, 0);
  let admitted = 0;
  const result = await resolveLlmSchemaInput(context, '/schema', {...options, admitBytes: size => {admitted += size;}});
  assert.equal(result.description, 'x'.repeat(40000)); assert.equal(admitted, bytes.length); assert.ok(largest <= 16384); assert.equal(closes, opens);
  await assert.rejects(resolveLlmSchemaInput(context, '/schema', {...options, admitBytes: () => {throw new Error('caller quota');}}), /caller quota/);
  assert.equal(closes, opens);
});

test('shared schema resolver supports host history lookup and rejects malformed controls and cancellation', async () => {
  const fs = new MemoryFileSystem();
  const controller = new AbortController();
  const context = {fs, cwd: '/', signal: controller.signal};
  const schema = {type: 'object'};
  const options = {loadTemplate: async () => ({name: 'empty'}), loadSchema: async (id: string) => id === 'stored-id' ? schema : undefined};
  assert.deepEqual(await resolveLlmSchemaInput(context, 'stored-id', options), schema);
  await assert.rejects(resolveLlmSchemaInput(context, 'missing', options), /Invalid schema/);
  await assert.rejects(resolveLlmSchemaInput(context, 't:empty', options), /has no schema/);
  await fs.writeFile('/array', new TextEncoder().encode('[]'));
  await assert.rejects(resolveLlmSchemaInput(context, '/array', options), /Invalid schema/);
  controller.abort(new Error('cancelled'));
  await assert.rejects(resolveLlmSchemaInput(context, '{}', options), /cancelled/);
});
