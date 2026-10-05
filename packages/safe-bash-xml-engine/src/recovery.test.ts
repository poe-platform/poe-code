import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { parseXmlRecovery } from './recovery.js';
import { XmlBudget, resolveXmlQueryLimits } from './limits.js';

for (const outcome of ['success', 'source', 'write', 'read', 'cancel', 'consumer', 'invalid'] as const)
test(`recovery source uses bounded injected backing and retires it: ${outcome}`, async () => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error(outcome);
  let opened = 0, closed = 0, writes = 0, reads = 0, outstanding = 0, sourceClosed = false, elements = 0;
  const injected = new Proxy(fs, { get(target, key) {
    if (key === 'readFile' || key === 'writeFile') return () => assert.fail('recovery must use positioned I/O');
    if (key === 'open') return async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args); opened++;
      return new Proxy(handle, { get(descriptor, member) {
        if (member === 'write') return async (...values: Parameters<typeof handle.write>) => {
          outstanding += values[0].byteLength; writes++;
          assert.ok(outstanding <= 16384);
          try {
            await Promise.resolve();
            if (outcome === 'write') throw failure;
            if (outcome === 'cancel') controller.abort(failure);
            return await handle.write(...values);
          } finally { outstanding -= values[0].byteLength; }
        };
        if (member === 'read') return async (...values: Parameters<typeof handle.read>) => {
          outstanding += values[0].byteLength; reads++;
          assert.ok(outstanding <= 16384);
          try {
            await Promise.resolve();
            if (outcome === 'read') throw failure;
            return await handle.read(...values);
          } finally { outstanding -= values[0].byteLength; }
        };
        if (member === 'close') return async () => { closed++; await handle.close(); };
        const value = Reflect.get(descriptor, member, descriptor);
        return typeof value === 'function' ? value.bind(descriptor) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const source = { async *[Symbol.asyncIterator]() {
    try {
      yield '<r>';
      const record = '<x>' + 'a'.repeat(512) + '</x>';
      for (let index = 0; index < 256; index++) yield record;
      if (outcome === 'source') throw failure;
      if (outcome === 'invalid') yield '\uD800';
    } finally { sourceClosed = true; }
  } };
  const messages: string[] = [];
  const operation = parseXmlRecovery(source, { fs: injected, cwd: '/', env: {}, signal: controller.signal },
    new XmlBudget(resolveXmlQueryLimits(), controller.signal, async () => {}), message => messages.push(message), async event => {
      await Promise.resolve();
      if (outcome === 'consumer') throw failure;
      if (event.type === 'open') elements++;
    });
  if (outcome === 'success') {
    const root = await operation;
    assert.equal(elements, 257);
    assert.deepEqual(root.children, []);
    assert.deepEqual(messages, ['incomplete document']);
    assert.ok(reads > 0);
  } else if (outcome === 'invalid') await assert.rejects(operation, /invalid character/);
  else await assert.rejects(operation, error => error === failure);
  assert.ok(writes > 0);
  assert.equal(opened, 1); assert.equal(closed, opened);
  assert.equal(outstanding, 0); assert.equal(sourceClosed, true);
  assert.deepEqual(await fs.readdir('/'), []);
});

test('recovery retains normalization work accounting at a split surrogate boundary', async () => {
  const { parseXmlSteps } = await import('@poe-code/safe-fs/core');
  const input = '<r>' + 'a'.repeat(508) + '😀</r>';
  let expected = 0;
  for (const work of parseXmlSteps(input, { retainTree: false, recover() {} })) expected += work;
  const signal = new AbortController().signal;
  const budget = new XmlBudget(resolveXmlQueryLimits({ maxSteps: expected }), signal, async () => {});
  const root = await parseXmlRecovery([input], { fs: createMemoryFileSystem(), cwd: '/', env: {}, signal }, budget, () => {});
  assert.equal(root.name, 'r');
});

for (const outcome of ['success', 'cancel', 'read'] as const) test(`recovery ancestry spills even when source fits in cache (${outcome})`, async () => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error('ancestry storage stopped');
  let writes = 0, opened = 0, closed = 0, closes = 0;
  const injected = new Proxy(fs, { get(target, key) {
    if (key === 'open') return async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args); opened++;
      return new Proxy(handle, { get(descriptor, member) {
        if (member === 'write') return async (...values: Parameters<typeof handle.write>) => {
          writes++; assert.ok(values[0].length <= 16384);
          if (outcome === 'cancel') controller.abort(failure);
          return handle.write(...values);
        };
        if (member === 'read') return async (...values: Parameters<typeof handle.read>) => {
          if (outcome === 'read' && closes > 0 && values[1] !== null && values[1] >= 32768) throw failure;
          return handle.read(...values);
        };
        if (member === 'close') return async () => { closed++; await handle.close(); };
        const value = Reflect.get(descriptor, member, descriptor);
        return typeof value === 'function' ? value.bind(descriptor) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const depth = 600;
  const source = { async *[Symbol.asyncIterator]() {
    for (let index = 0; index < depth; index++) yield `<x xmlns:p="urn:${index}">`;
  } };
  const operation = parseXmlRecovery(source, { fs: injected, cwd: '/', env: {}, signal: controller.signal },
    new XmlBudget(resolveXmlQueryLimits(), controller.signal, async () => {}), () => {}, async event => {
      if (event.type === 'close') {
        assert.equal(event.element.namespaces.get('p'), `urn:${depth - ++closes}`);
        assert.equal(event.parent?.namespaces.get('p'), closes < depth ? `urn:${depth - closes - 1}` : undefined);
      }
    });
  if (outcome !== 'success') await assert.rejects(operation, error => error === failure);
  else { await operation; assert.equal(closes, depth); }
  assert.ok(writes > 0, 'parser ancestry must reach injected backing even for a source smaller than 64 KiB');
  assert.equal(opened, 1); assert.equal(closed, opened);
  assert.deepEqual(await fs.readdir('/'), []);
});
