import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import type { CommandContext, InvocationCleanup } from "../../../src/contracts/index.js";
import { createIconvCommand } from "../../../src/commands/iconv/index.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

for (const origin of ['caller', 'registered-close'] as const) {
  for (const held of [false, true]) {
    test(`admitted readStream cleanup after ${origin}, held ${held}`, async testContext => {
      const memory = new MemoryFileSystem(), caller = new AbortController(), release = deferred();
      await memory.writeFile('/input', Uint8Array.of(65, 13, 10));
      let close: InvocationCleanup | undefined, closure: Promise<void> | undefined;
      let acquisitions = 0, factories = 0, returns = 0, pulls = 0, settled = false;
      const iterator = {
        async next() { pulls++; assert.fail('closed input must never advance'); },
        async return() {
          assert.equal(this, iterator); returns++;
          if (held) await release.promise;
          return { done: true as const, value: undefined };
        },
      };
      const source = { [Symbol.asyncIterator]() { assert.equal(this, source); factories++; return iterator; } };
      Object.defineProperty(memory, 'readStream', { value() {
        assert.equal(this, memory); acquisitions++;
        if (origin === 'caller') caller.abort(false);
        else { assert.ok(close); closure = Promise.resolve(close()); }
        return source;
      } });
      const context: CommandContext = {
        command: 'iconv', args: ['/input'], cwd: '/', env: { LC_ALL: 'C' }, fs: memory, signal: caller.signal,
        stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() { assert.fail('no stdout'); } }, stderr: { async write() { assert.fail('no diagnostics after closure'); } },
        registerCleanup(cleanup) { assert.equal(this, context); close = cleanup; },
      };
      const execution = Promise.resolve(createIconvCommand().execute(context));
      void execution.then(() => { settled = true; }, () => { settled = true; });
      try {
        await setImmediate();
        testContext.diagnostic(JSON.stringify({ origin, held, acquisitions, factories, returns, pulls, settled }));
        assert.equal(acquisitions, 1);
        assert.equal(factories, 1, 'already-admitted returned source must be acquired only for cleanup');
        assert.equal(returns, 1, 'owned cleanup must not disappear on registered close');
        if (held) assert.equal(settled, false, 'cooperative return must drain');
        assert.equal(pulls, 0);
        release.resolve();
        await assert.rejects(execution, error => origin === 'caller' ? Object.is(error, false) : error instanceof Error);
        assert.deepEqual(await memory.readFile('/input'), Uint8Array.of(65, 13, 10));
      } finally { release.resolve(); await execution.catch(() => {}); await closure; }
    });
  }
}
