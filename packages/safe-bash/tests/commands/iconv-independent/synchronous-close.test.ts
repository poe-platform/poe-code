import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createIconvCommand } from "../../../src/commands/iconv/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import type { CommandContext, InvocationCleanup } from "../../../src/contracts/index.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const signal = new AbortController().signal;
  let close: InvocationCleanup | undefined;
  const context: { -readonly [Key in keyof CommandContext]: CommandContext[Key] } = {
    command: 'iconv', args: [], cwd: '/', env: { LC_ALL: 'C' }, fs: new MemoryFileSystem(), signal,
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write() {} },
    registerCleanup(cleanup) { assert.equal(this, context); close = cleanup; },
  };
  return { context, close() { assert.ok(close); return Promise.resolve(close()); }, async run() { return createIconvCommand().execute(context); } };
}

for (const done of [false, true]) {
  for (const held of [false, true]) {
    test(`done getter close ${done}, held cooperative return ${held}`, async testContext => {
      const setup = fixture(), release = deferred();
      let closure: Promise<void> | undefined;
      let doneReads = 0, valueReads = 0, pulls = 0, returns = 0, settled = false;
      const result = {
        get done() { doneReads++; closure = setup.close(); return done; },
        get value() { valueReads++; return Uint8Array.of(65); },
      };
      const iterator = {
        async next() { assert.equal(this, iterator); pulls++; return result; },
        async return() {
          assert.equal(this, iterator); returns++;
          if (held) await release.promise;
          return { done: true as const, value: undefined };
        },
      };
      setup.context.stdin = { [Symbol.asyncIterator]() { return iterator; } };
      const execution = setup.run();
      void execution.then(() => { settled = true; }, () => { settled = true; });
      try {
        await setImmediate();
        testContext.diagnostic(JSON.stringify({ done, held, doneReads, valueReads, pulls, returns, settled }));
        assert.equal(doneReads, 1);
        assert.equal(valueReads, 0, 'no new value getter after close from done');
        assert.equal(returns, 1, 'acquired iterator must remain owned for return');
        if (held) assert.equal(settled, false, 'actual cooperative return must drain');
        release.resolve();
        await execution.catch(() => {});
        assert.equal(pulls, 1);
      } finally { release.resolve(); await execution.catch(() => {}); await closure; }
    });
  }
}

for (const boundary of ['args', 'first-index'] as const) {
  test(`close from ${boundary} stops remaining argument and IO admission`, async testContext => {
    const setup = fixture();
    let closure: Promise<void> | undefined;
    let carrierReads = 0, firstReads = 0, secondReads = 0, stdinReads = 0, writes = 0;
    const args = ['-f', 'ASCII'];
    Object.defineProperty(args, 0, { get() { firstReads++; if (boundary === 'first-index') closure = setup.close(); return '-f'; } });
    Object.defineProperty(args, 1, { get() { secondReads++; return 'ASCII'; } });
    Object.defineProperty(setup.context, 'args', { get() { if (boundary === 'args') closure = setup.close(); return args; } });
    Object.defineProperty(setup.context, 'argumentValues', { get() { carrierReads++; return undefined; } });
    Object.defineProperty(setup.context, 'stdin', { get() { stdinReads++; return { async *[Symbol.asyncIterator]() {} }; } });
    setup.context.stdout = { async write() { writes++; } };
    setup.context.stderr = { async write() { writes++; } };
    try {
      await setup.run().catch(() => {});
      testContext.diagnostic(JSON.stringify({ boundary, carrierReads, firstReads, secondReads, stdinReads, writes }));
      assert.equal(firstReads, boundary === 'args' ? 0 : 1, 'no first argument read after args getter closes');
      assert.equal(secondReads, 0, 'no later argument read after close');
      assert.equal(carrierReads, boundary === 'args' ? 0 : 1, 'no carrier read after args getter closes');
      assert.equal(stdinReads, 0);
      assert.equal(writes, 0);
    } finally { await closure; }
  });
}

for (const held of [false, true]) {
  test(`registered close preserves admitted diagnostic and actual drain, held ${held}`, async () => {
    const setup = fixture(), entered = deferred(), release = deferred();
    setup.context.args = ['-f', 'unsupported'];
    let closure: Promise<void> | undefined;
    let writes = 0, settled = false;
    const capability = {
      consumerClosed: new AbortController().signal,
      get write() {
        assert.equal(this, capability);
        closure = setup.close();
        assert.equal(setup.close(), closure);
        return async function(this: unknown) {
          assert.equal(this, capability); writes++; entered.resolve();
          if (held) await release.promise;
        };
      },
    };
    setup.context.stderr = { async write() { assert.fail('opaque diagnostic route'); }, ownedOutput: capability };
    const execution = setup.run();
    void execution.then(() => { settled = true; }, () => { settled = true; });
    try {
      await entered.promise;
      if (held) { await setImmediate(); assert.equal(settled, false); }
      release.resolve();
      assert.equal((await execution).exitCode, 1);
      assert.equal(writes, 1);
      assert.equal(setup.context.signal.aborted, false);
    } finally { release.resolve(); await execution.catch(() => {}); await closure; }
  });
}

test('close from environment getter stops locale getter admission', async testContext => {
  const setup = fixture();
  let closure: Promise<void> | undefined;
  let locales = 0, stdinReads = 0, writes = 0;
  const env = { get LC_ALL() { locales++; return 'C'; } };
  Object.defineProperty(setup.context, 'env', { get() { closure = setup.close(); return env; } });
  Object.defineProperty(setup.context, 'stdin', { get() { stdinReads++; return { async *[Symbol.asyncIterator]() {} }; } });
  setup.context.stdout = { async write() { writes++; } };
  setup.context.stderr = { async write() { writes++; } };
  try {
    await setup.run().catch(() => {});
    testContext.diagnostic(JSON.stringify({ locales, stdinReads, writes }));
    assert.equal(locales, 0, 'no locale getter after context.env closes');
    assert.equal(stdinReads, 0);
    assert.equal(writes, 0);
  } finally { await closure; }
});
