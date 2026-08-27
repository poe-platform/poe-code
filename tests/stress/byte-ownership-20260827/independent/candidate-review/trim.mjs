import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { geometry, retention, kinds, commands, bounds } from './trim-vectors.mjs';

const { streamCommands } = await import(pathToFileURL(process.env.OWNERSHIP_STREAMS));
const { CommandRegistry } = await import(pathToFileURL(process.env.OWNERSHIP_PUBLIC));
const registry = new CommandRegistry(streamCommands());
const NativeBytes = Uint8Array;
const nativeSlice = NativeBytes.prototype.slice;
const nativeSubarray = NativeBytes.prototype.subarray;
const nativeSet = NativeBytes.prototype.set;
const nativeBufferSlice = Buffer.prototype.slice;
const nativePush = Array.prototype.push;
const nativeArraySlice = Array.prototype.slice;
const append = (array, value) => Reflect.apply(nativePush, array, [value]);

function meter() {
  const state = { enabled: true, copied: 0, allocated: 0, constructorBytes: 0, sliceBytes: 0, setBytes: 0, queue: undefined, checkpoints: [] };
  const observe = array => {
    if (state.enabled && array.some(item => item instanceof NativeBytes)) state.queue = new WeakRef(array);
  };
  globalThis.Uint8Array = new Proxy(NativeBytes, {
    construct(target, args, newTarget) {
      const result = Reflect.construct(target, args, newTarget);
      if (state.enabled && !(args[0] instanceof ArrayBuffer) && !(args[0] instanceof SharedArrayBuffer)) {
        state.allocated += result.byteLength;
        if (typeof args[0] !== 'number' && args[0] !== undefined) {
          state.copied += result.byteLength;
          state.constructorBytes += result.byteLength;
        }
      }
      return result;
    },
  });
  NativeBytes.prototype.slice = function (...args) {
    const result = Reflect.apply(nativeSlice, this, args);
    if (state.enabled) { state.copied += result.byteLength; state.allocated += result.byteLength; state.sliceBytes += result.byteLength; }
    return result;
  };
  NativeBytes.prototype.set = function (source, offset) {
    const result = Reflect.apply(nativeSet, this, [source, offset]);
    if (state.enabled) { state.copied += source.length; state.setBytes += source.length; }
    return result;
  };
  Buffer.prototype.slice = function (...args) { return Reflect.apply(nativeBufferSlice, this, args); };
  Array.prototype.push = function (...items) {
    const result = Reflect.apply(nativePush, this, items);
    if (items.some(item => item instanceof NativeBytes)) observe(this);
    return result;
  };
  Array.prototype.slice = function (...args) {
    const result = Reflect.apply(nativeArraySlice, this, args);
    observe(result);
    return result;
  };
  return {
    state,
    outside(action) {
      const previous = state.enabled;
      state.enabled = false;
      try { return action(); } finally { state.enabled = previous; }
    },
    checkpoint() {
      const queue = state.queue?.deref();
      assert.ok(queue, 'instrumentation must observe the actual byte queue');
      const backing = new Set(queue.filter(item => item instanceof NativeBytes).map(item => item.buffer));
      const retained = [...backing].reduce((total, buffer) => total + buffer.byteLength, 0);
      append(state.checkpoints, retained);
    },
    restore() {
      globalThis.Uint8Array = NativeBytes;
      NativeBytes.prototype.slice = nativeSlice;
      NativeBytes.prototype.set = nativeSet;
      Buffer.prototype.slice = nativeBufferSlice;
      Array.prototype.push = nativePush;
      Array.prototype.slice = nativeArraySlice;
    },
  };
}

function generated(kind, workload, instrumentation, afterRead) {
  const storage = kind.endsWith('Uint8Array') ? new NativeBytes(workload.first + 19) : Buffer.alloc(workload.first + 19);
  const expected = Buffer.alloc(workload.first + workload.followups);
  for (let index = 0; index < expected.length; index++) expected[index] = (index * 37 + 11) % 256;
  const state = { reads: 0, finalized: false, checked: 0 };
  const source = (async function* () {
    try {
      for (let index = 0; index <= workload.followups; index++) {
        const length = index === 0 ? workload.first : 1;
        const offset = index === 0 ? 0 : workload.first + index - 1;
        const bytes = instrumentation.outside(() => {
          const target = kind === 'immutable-Buffer' ? Buffer.alloc(length + 19) : storage;
          target.fill(0xc7);
          const view = Reflect.apply(nativeSubarray, target, [9, 9 + length]);
          Reflect.apply(nativeSet, view, [expected.subarray(offset, offset + length), 0]);
          return view;
        });
        const before = Buffer.from(bytes).toString('hex');
        state.reads++;
        try { yield bytes; }
        finally {
          instrumentation.outside(() => assert.equal(Buffer.from(bytes).toString('hex'), before, 'borrowed input mutated'));
          state.checked++;
        }
        instrumentation.outside(() => instrumentation.checkpoint());
        afterRead?.(state.reads);
      }
    } finally {
      storage.fill(0);
      state.finalized = true;
    }
  })();
  return { source, expected, state };
}

async function invoke(command, count, source, sink, signal = new AbortController().signal) {
  const diagnostics = [];
  const result = await registry.get(command).execute({
    command, args: ['-c', command === 'head' ? `-${count}` : String(count)], stdin: source,
    stdout: sink, stderr: { async write(chunk) { append(diagnostics, Buffer.from(chunk)); } },
    cwd: '/', env: {}, signal,
    fs: new Proxy({}, { get() { throw new Error('stdin-only test must not access filesystem'); } }),
  });
  return { exitCode: result.exitCode, stderr: Buffer.concat(diagnostics).toString() };
}

test('isolated copy-meter calibration', () => {
  const instrumentation = meter();
  try {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    bytes.slice(1);
    bytes.subarray(1);
    new Uint8Array(8).set(bytes);
    assert.equal(instrumentation.state.copied, 11);
    assert.equal(instrumentation.state.allocated, 15);
  } finally { instrumentation.restore(); }
});

for (const family of ['geometry', 'retention']) {
  for (const workload of family === 'geometry' ? geometry : retention) {
    for (const kind of kinds) for (const command of commands) {
      test(`${family} ${command} ${kind} ${workload.first}/${workload.followups}/${workload.count}`, { timeout: 10000 }, async context => {
        const instrumentation = meter();
        const output = [];
        try {
          const fixture = instrumentation.outside(() => generated(kind, workload, instrumentation));
          const result = await invoke(command, workload.count, fixture.source, { async write(chunk) {
            instrumentation.outside(() => append(output, Buffer.from(chunk)));
          } });
          instrumentation.outside(() => {
            const expected = command === 'tail' ? fixture.expected.subarray(-workload.count) : fixture.expected.subarray(0, -workload.count);
            const summary = { input: fixture.expected.length, count: workload.count, copied: instrumentation.state.copied, allocated: instrumentation.state.allocated, constructorBytes: instrumentation.state.constructorBytes, sliceBytes: instrumentation.state.sliceBytes, setBytes: instrumentation.state.setBytes, maxRetained: Math.max(...instrumentation.state.checkpoints), checkpoints: instrumentation.state.checkpoints.length };
            context.diagnostic(JSON.stringify(summary));
            assert.deepEqual(result, { exitCode: 0, stderr: '' });
            assert.deepEqual(Buffer.concat(output), expected);
            assert.deepEqual(fixture.state, { reads: workload.followups + 1, finalized: true, checked: workload.followups + 1 });
            assert.equal(summary.checkpoints, workload.followups + 1);
            assert.ok(summary.copied <= bounds.copyInput * summary.input + bounds.copyCount * summary.count + bounds.copySlack, 'copy bytes exceed frozen linear envelope');
            assert.ok(summary.allocated <= bounds.allocateInput * summary.input + bounds.allocateCount * summary.count + bounds.allocateSlack, 'allocated bytes exceed frozen linear envelope');
            assert.ok(summary.maxRetained <= bounds.backingCount * summary.count + bounds.backingSlack, 'retained backing exceeds frozen count-relative envelope');
          });
        } finally { instrumentation.restore(); }
      });
    }
  }
}

for (const mode of ['backpressure', 'source-error', 'sink-error', 'abort']) {
  test(`head exclusion ${mode} preserves lease and cleanup`, { timeout: 10000 }, async () => {
    const instrumentation = meter();
    const controller = new AbortController();
    const reason = new Error(`independent head ${mode}`);
    const fixture = instrumentation.outside(() => generated('borrowed-Buffer', { first: 19, followups: 3, count: 7 }, instrumentation, reads => {
      if (reads === 1 && mode === 'source-error') throw reason;
      if (reads === 1 && mode === 'abort') controller.abort(reason);
    }));
    try {
      const pending = invoke('head', 7, fixture.source, { async write(chunk) {
        const reads = fixture.state.reads;
        const before = Buffer.from(chunk);
        await setImmediate();
        instrumentation.outside(() => {
          assert.equal(fixture.state.reads, reads, 'producer advanced before sink acceptance');
          assert.deepEqual(Buffer.from(chunk), before);
        });
        if (mode === 'sink-error') throw reason;
      } }, controller.signal);
      if (mode === 'abort') await assert.rejects(pending, error => error === reason);
      else {
        const result = await pending;
        assert.deepEqual(result, mode === 'source-error' || mode === 'sink-error' ? { exitCode: 1, stderr: `head: ${reason.message}\n` } : { exitCode: 0, stderr: '' });
      }
      assert.equal(fixture.state.finalized, true);
      assert.equal(fixture.state.checked, fixture.state.reads);
    } finally { instrumentation.restore(); }
  });
}
