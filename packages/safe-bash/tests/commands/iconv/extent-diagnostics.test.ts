import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { MemoryFileSystem } from '../../../src/fs/memory/index.js';
import { FsError, type CommandContext, type InvocationCleanup } from '../../../src/contracts/index.js';
import { createIconvCommand } from '../../../src/commands/iconv/index.js';
import { run } from './helpers.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const caller = new AbortController();
  const context: { -readonly [Key in keyof CommandContext]: CommandContext[Key] } = {
    command: 'iconv', args: ['-f', 'unsupported'], cwd: '/', env: { LC_ALL: 'C' },
    fs: new MemoryFileSystem(), signal: caller.signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write() {} }, stderr: { async write() {} },
  };
  return { context, caller, run: async () => createIconvCommand().execute(context) };
}

for (const route of ['stdin', 'fallback'] as const) {
  for (const shape of ['short-length', 'long-length', 'throw-length', 'view-getters', 'iterator'] as const) {
    test(`${route} intrinsic input preserves extent without ${shape} hooks`, async () => {
      class Input extends Uint8Array {}
      const value = new Input([0, 65, 255]);
      let hooks = 0;
      if (shape === 'short-length' || shape === 'long-length') Object.defineProperty(value, 'length', { get() { hooks++; return shape === 'short-length' ? 0 : 90; } });
      if (shape === 'throw-length') Object.defineProperty(value, 'length', { get() { hooks++; throw new Error('untrusted length'); } });
      if (shape === 'view-getters') for (const key of ['buffer', 'byteOffset', 'byteLength']) Object.defineProperty(value, key, { get() { hooks++; throw new Error(key); } });
      if (shape === 'iterator') Object.defineProperty(value, Symbol.iterator, { get() { hooks++; throw new Error('iterator'); } });
      const fs = new MemoryFileSystem();
      await fs.writeFile('/input', Uint8Array.of(1));
      Object.defineProperties(fs, { capabilitiesFor: { value: () => ({ streamingRead: false }) }, readFile: { value: async () => value } });
      const result = await run(['-f', 'latin1', '-t', 'latin1', ...(route === 'fallback' ? ['/input'] : [])], new Uint8Array(), {}, {
        fs, stdin: { async *[Symbol.asyncIterator]() { yield value; } },
      });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdoutHex, '0041ff');
      assert.equal(hooks, 0);
      assert.equal(value[2], 255);
    });
  }
  test(`${route} actual producer extent is refused by the input cap`, async () => {
    class Input extends Uint8Array {}
    const value = new Input(8).fill(65);
    let hooks = 0, returned = 0;
    Object.defineProperty(value, 'length', { get() { hooks++; return 0; } });
    const fs = new MemoryFileSystem();
    await fs.writeFile('/input', Uint8Array.of(1));
    Object.defineProperties(fs, { capabilitiesFor: { value: () => ({ streamingRead: false }) }, readFile: { value: async () => value } });
    const result = await run(['-f', 'latin1', '-t', 'latin1', ...(route === 'fallback' ? ['/input'] : [])], new Uint8Array(), { limits: { maxInputBytes: 4 } }, {
      fs, stdin: { async *[Symbol.asyncIterator]() { try { yield value; } finally { returned++; } } },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdoutHex, '');
    assert.ok(Buffer.from(result.stderrHex, 'hex').toString().includes('input bytes limit exceeded'));
    assert.equal(hooks, 0);
    assert.equal(returned, route === 'stdin' ? 1 : 0);
  });
}

for (const reason of [false, 0, '', null]) {
  test(`closed diagnostic destination blocks write: ${JSON.stringify(reason)}`, async () => {
    const setup = fixture(), diagnostic = new AbortController();
    diagnostic.abort(reason);
    let writes = 0;
    setup.context.stderr = { async write() { assert.fail('opaque diagnostic route'); }, ownedOutput: {
      consumerClosed: diagnostic.signal, async write() { writes++; },
    } };
    await assert.rejects(setup.run(), error => Object.is(error, reason));
    assert.equal(writes, 0);
    assert.equal(setup.caller.signal.aborted, false);
  });
  test(`unused closed stderr does not affect valid conversion: ${JSON.stringify(reason)}`, async () => {
    const setup = fixture(), diagnostic = new AbortController();
    diagnostic.abort(reason);
    setup.context.args = [];
    let reads = 0;
    Object.defineProperty(setup.context, 'stderr', { get() {
      reads++;
      return { async write() {}, ownedOutput: { consumerClosed: diagnostic.signal, async write() {} } };
    } });
    assert.equal((await setup.run()).exitCode, 0);
    assert.equal(reads, 0);
  });
  for (const origin of ['stderr', 'stdout'] as const) {
    test(`diagnostic getter closes ${origin} without losing receiver/drain: ${JSON.stringify(reason)}`, async () => {
      const setup = fixture(), diagnostic = new AbortController(), stdout = new AbortController();
      const gate = deferred();
      let writes = 0, settled = false;
      setup.context.stdout = { async write() {}, ownedOutput: { consumerClosed: stdout.signal, async write() {} } };
      const capability = { consumerClosed: diagnostic.signal, get write() {
        assert.equal(this, capability);
        (origin === 'stderr' ? diagnostic : stdout).abort(reason);
        return async function(this: unknown) { assert.equal(this, capability); writes++; await gate.promise; };
      } };
      setup.context.stderr = { async write() { assert.fail('opaque route'); }, ownedOutput: capability };
      const execution = setup.run();
      void execution.then(() => { settled = true; }, () => { settled = true; });
      try {
        await setImmediate();
        assert.equal(writes, origin === 'stderr' ? 0 : 1);
        if (origin === 'stdout') assert.equal(settled, false);
        gate.resolve();
        await assert.rejects(execution, error => Object.is(error, reason));
      } finally { gate.resolve(); await execution.catch(() => {}); }
    });
  }
  for (const origin of ['stderr', 'caller', 'stdout'] as const) {
    test(`held diagnostic drains after ${origin} cancellation: ${JSON.stringify(reason)}`, async () => {
      const setup = fixture(), diagnostic = new AbortController(), stdout = new AbortController();
      const entered = deferred(), gate = deferred();
      let writes = 0, settled = false;
      const capability = { consumerClosed: diagnostic.signal, async write() { assert.equal(this, capability); writes++; entered.resolve(); await gate.promise; } };
      setup.context.stdout = { async write() {}, ownedOutput: { consumerClosed: stdout.signal, async write() {} } };
      setup.context.stderr = { async write() { assert.fail('opaque route'); }, ownedOutput: capability };
      const execution = setup.run();
      void execution.then(() => { settled = true; }, () => { settled = true; });
      try {
        await entered.promise;
        if (origin === 'caller') { diagnostic.abort('secondary'); setup.caller.abort(reason); }
        else (origin === 'stderr' ? diagnostic : stdout).abort(reason);
        await setImmediate();
        assert.equal(settled, false);
        gate.resolve();
        await assert.rejects(execution, error => Object.is(error, reason));
        assert.equal(writes, 1);
      } finally { gate.resolve(); await execution.catch(() => {}); }
    });
  }
}

for (const boundary of ['stderr', 'ownedOutput', 'consumerClosed'] as const) {
  test(`diagnostic ${boundary} is captured once across missing-file diagnostics`, async () => {
    const setup = fixture(), consumer = new AbortController();
    setup.context.args = ['/missing-one', '/missing-two'];
    let reads = 0, writes = 0;
    const capability = { consumerClosed: consumer.signal, async write() { assert.equal(this, capability); writes++; } };
    const sink = { ownedOutput: capability, async write() { assert.fail('opaque route'); } };
    setup.context.stderr = sink;
    if (boundary === 'stderr') Object.defineProperty(setup.context, 'stderr', { get() { reads++; assert.equal(this, setup.context); return sink; } });
    else if (boundary === 'ownedOutput') Object.defineProperty(sink, boundary, { get() { reads++; assert.equal(this, sink); return capability; } });
    else Object.defineProperty(capability, boundary, { get() { reads++; assert.equal(this, capability); return consumer.signal; } });
    assert.equal((await setup.run()).exitCode, 1);
    assert.equal(writes, 2);
    assert.equal(reads, 1);
  });
}

for (const reporting of [new Error('reporting failure'), false, 0, '', null]) {
  for (const boundary of ['method', 'getter'] as const) {
    test(`unrelated diagnostic ${boundary} throw retains provenance: ${String(reporting)}`, async () => {
      const setup = fixture(), diagnostic = new AbortController();
      const capability = { consumerClosed: diagnostic.signal, async write() { diagnostic.abort(false); throw reporting; } };
      if (boundary === 'getter') Object.defineProperty(capability, 'write', { get() { diagnostic.abort(false); throw reporting; } });
      setup.context.stderr = { async write() {}, ownedOutput: capability };
      await assert.rejects(setup.run(), error => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.message, 'iconv failure reporting failed');
        assert.equal(error.errors.length, 2);
        assert.ok(error.errors[0] instanceof Error);
        assert.ok(Object.is(error.errors[1], reporting));
        return true;
      });
    });
  }
}

for (const outcome of ['eof', 'reader-error'] as const) {
  for (const held of [false, true]) {
    test(`close blocks fresh diagnostics after ${outcome}, held return ${held}`, async () => {
      const setup = fixture(), entered = deferred(), gate = deferred();
      setup.context.args = [];
      let close: InvocationCleanup | undefined, closure: Promise<void> | undefined;
      let reads = 0, writes = 0, returns = 0, settled = false;
      const iterator = {
        async next() {
          assert.equal(this, iterator); assert.ok(close); closure = Promise.resolve(close());
          if (outcome === 'reader-error') throw new FsError('EIO', { path: 'stdin' });
          return { done: true as const, value: undefined };
        },
        async return() { assert.equal(this, iterator); returns++; entered.resolve(); if (held) await gate.promise; return { done: true as const, value: undefined }; },
      };
      setup.context.stdin = { [Symbol.asyncIterator]() { return iterator; } };
      setup.context.registerCleanup = cleanup => { close = cleanup; };
      Object.defineProperty(setup.context, 'stderr', { get() { reads++; return { async write() { writes++; } }; } });
      const execution = setup.run();
      void execution.then(() => { settled = true; }, () => { settled = true; });
      try {
        await entered.promise;
        if (held) { await setImmediate(); assert.equal(settled, false); }
        assert.equal(reads, 0); assert.equal(writes, 0);
        gate.resolve();
        await assert.rejects(execution, error => error instanceof AggregateError && error.message === 'iconv failure reporting failed');
        assert.equal(returns, 1);
      } finally { gate.resolve(); await execution.catch(() => {}); await closure; }
    });
  }
}
