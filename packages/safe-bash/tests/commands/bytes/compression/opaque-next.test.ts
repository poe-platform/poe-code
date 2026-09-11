import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { run, wrap, deferred } from './helpers.js';
import { createMemoryFileSystem } from '../../../../src/fs/memory/index.js';

for (const late of ['rejection', 'result'] as const) test(`file cancellation drains return but not opaque next ${late}`, async () => {
  const memory = createMemoryFileSystem();
  const original = Uint8Array.of(65, 10);
  await memory.writeFile('/input', original);
  const controller = new AbortController();
  const entered = deferred(), returning = deferred(), releaseReturn = deferred();
  const rawNext = deferred<IteratorResult<Uint8Array>>();
  let returns = 0, reads = 0, settled = false, lateGetters = 0;
  const fs = wrap(memory, {
    readStream() {
      return { [Symbol.asyncIterator]() { return {
        next() { reads++; entered.resolve(); return rawNext.promise; },
        async return() { returns++; returning.resolve(); await releaseReturn.promise; return { done: true as const, value: undefined }; },
      }; } };
    },
  });
  const pending = run('gzip', ['input'], undefined, { fs, signal: controller.signal }).then(value => ({ value }), reason => ({ reason }));
  void pending.then(() => { settled = true; });
  try {
    await entered.promise;
    controller.abort(false);
    await returning.promise;
    for (let turn = 0; turn < 5; turn++) await setImmediate();
    assert.equal(settled, false, 'cooperative return must drain before public rejection');
    releaseReturn.resolve();
    for (let turn = 0; turn < 5; turn++) await setImmediate();
    assert.equal(settled, true, 'completed return must not wait for opaque raw next');
    assert.deepEqual(await pending, { reason: false });
    assert.deepEqual((await memory.readdir('/')).map(entry => entry.name), ['input']);
    assert.deepEqual(await memory.readFile('/input'), original);
  } finally {
    releaseReturn.resolve();
    if (late === 'rejection') rawNext.reject(new Error('late opaque next rejection'));
    else rawNext.resolve({ get done() { lateGetters++; return false as const; }, get value() { lateGetters++; return original; } });
    await pending;
    for (let turn = 0; turn < 5; turn++) await setImmediate();
  }
  assert.equal(reads, 1);
  assert.equal(returns, 1);
  assert.equal(lateGetters, 0);
});
