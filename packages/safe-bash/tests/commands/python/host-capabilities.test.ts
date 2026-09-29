import assert from 'node:assert/strict';
import test from 'node:test';
import { createPythonHostBridge } from '../../../src/commands/python/host-capabilities.js';

test('structured calls preserve data and scope and retire deterministically', async () => {
  const controller = new AbortController();
  const bridge = createPythonHostBridge({ echo: { async call(value, { signal }) { assert.equal(signal.aborted, false); return value; } } }, { signal: controller.signal });
  assert.deepEqual(await bridge.request({ version: 1, operation: 'call', capability: 'echo', value: { count: 3, enabled: true } }), { count: 3, enabled: true });
  await bridge.close();
  await assert.rejects(bridge.request({ version: 1, operation: 'call', capability: 'echo', value: null }), /retired/);
});

test('streams pull once per request, preserve binary bytes, and close on early exit', async () => {
  let pulls = 0;
  let releases = 0;
  const bridge = createPythonHostBridge({ model: { stream() { return { [Symbol.asyncIterator]() { return { async next() { pulls++; return { done: false, value: new Uint8Array([0, 255, 128]) }; }, async return() { releases++; return { done: true, value: undefined }; } }; } }; } } }, { signal: new AbortController().signal });
  const handle = await bridge.request({ version: 1, operation: 'stream', capability: 'model', value: null });
  assert.equal(pulls, 0);
  assert.deepEqual(await bridge.request({ version: 1, operation: 'next', handle }), { done: false, value: { type: 'bytes', bytes: [0, 255, 128] } });
  await bridge.request({ version: 1, operation: 'release', handle });
  await bridge.close();
  assert.equal(pulls, 1);
  assert.equal(releases, 1);
});

test('rejects unknown authority and overflowing input/output', async () => {
  const bridge = createPythonHostBridge({ large: { async call() { return 'x'.repeat(200); } } }, { signal: new AbortController().signal, maxMessageBytes: 128 });
  await assert.rejects(bridge.request({ version: 1, operation: 'call', capability: 'other', value: null }), /Unknown/);
  await assert.rejects(bridge.request({ version: 1, operation: 'call', capability: 'large', value: 'x'.repeat(200) }), /limit/);
  await assert.rejects(bridge.request({ version: 1, operation: 'call', capability: 'large', value: null }), /limit/);
  await bridge.close();
});

test('retirement aborts pending calls and waits for their cleanup', async () => {
  let finished = false;
  const bridge = createPythonHostBridge({ delayed: { async call(_, { signal }) { await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); finished = true; return null; } } }, { signal: new AbortController().signal });
  const call = bridge.request({ version: 1, operation: 'call', capability: 'delayed', value: null });
  await Promise.resolve();
  const closing = bridge.close();
  await assert.rejects(call, /retired/);
  await closing;
  assert.equal(finished, true);
});

test('capabilities and stream handles are invocation-local', async () => {
  const make = (identity: string) => createPythonHostBridge({ who: { async call() { return identity; }, async *stream() { yield identity; } } }, { signal: new AbortController().signal });
  const first = make('first-user');
  const second = make('second-user');
  const handle = await first.request({ version: 1, operation: 'stream', capability: 'who' });
  await assert.rejects(second.request({ version: 1, operation: 'next', handle }), /Unknown/);
  assert.equal(await second.request({ version: 1, operation: 'call', capability: 'who' }), 'second-user');
  await first.close();
  assert.equal(await second.request({ version: 1, operation: 'call', capability: 'who' }), 'second-user');
  await second.close();
});

test('bounds composite payloads before serialization and refuses accessors', async () => {
  let called = false;
  const bridge = createPythonHostBridge({ echo: { async call() { called = true; return null; } } }, { signal: new AbortController().signal, maxMessageBytes: 256 });
  await assert.rejects(bridge.request({ version: 1, operation: 'call', capability: 'echo', value: ['x'.repeat(200), 'y'.repeat(200)] }), /limit/);
  await assert.rejects(bridge.request({ version: 1, operation: 'call', capability: 'echo', get value() { throw new Error('accessed getter'); } }), /data only/);
  assert.equal(called, false);
  await bridge.close();
});
