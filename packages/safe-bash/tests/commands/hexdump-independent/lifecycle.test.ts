import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createHexdumpCommand } from '../../../src/commands/hexdump/index.js';
import { MemoryFileSystem } from '../../../src/fs/memory/index.js';
import { outputFailure, type ByteSink, type CommandContext, type InvocationCleanup } from '../../../src/contracts/index.js';
import { registerYieldCheckpoint } from '../../../src/contracts/yield.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const caller = new AbortController();
  const cleanups: InvocationCleanup[] = [];
  let pulls = 0;
  const context: CommandContext = {
    command: 'hexdump', args: ['-C'], cwd: '/', env: { LC_ALL: 'C' }, fs: new MemoryFileSystem(), signal: caller.signal,
    stdin: { async *[Symbol.asyncIterator]() { pulls++; yield Uint8Array.of(65); } },
    stdout: { async write() {} }, stderr: { async write() { assert.fail('unexpected stderr'); } },
    registerCleanup(cleanup) { assert.equal(this, context); cleanups.push(cleanup); },
  };
  return { context, caller, get pulls() { return pulls; }, async run() {
    try { return await createHexdumpCommand().execute(context); }
    finally { for (const cleanup of cleanups) await cleanup(); }
  } };
}

for (const reason of [false, 0, '', null]) {
  test(`already-closed owned stderr does not admit diagnostic writes: ${JSON.stringify(reason)}`, async () => {
    const setup = fixture();
    const consumer = new AbortController();
    consumer.abort(reason);
    let writes = 0, rejected = false, failure: unknown;
    Object.assign(setup.context, { args: ['-e', 'unused'], stderr: {
      async write() { assert.fail('opaque diagnostic route'); },
      ownedOutput: { consumerClosed: consumer.signal, async write() { writes++; } },
    } });
    try { await setup.run(); } catch (error) { rejected = true; failure = error; }
    assert.equal(writes, 0, 'closed diagnostic consumer must block method admission');
    assert.equal(rejected, true);
    assert.ok(Object.is(failure, reason));
    assert.equal(setup.pulls, 0);
  });

  test(`consumer cancellation drains admitted write then iterator return: ${JSON.stringify(reason)}`, async () => {
    const setup = fixture();
    const consumer = new AbortController();
    const enteredWrite = deferred(), releaseWrite = deferred(), enteredReturn = deferred(), releaseReturn = deferred();
    let writes = 0, pulls = 0, returns = 0, settled = false;
    const iterator = {
      async next() { pulls++; return pulls === 1 ? { done: false as const, value: new Uint8Array(32) } : { done: true as const, value: undefined }; },
      async return() { assert.equal(this, iterator); returns++; enteredReturn.resolve(); await releaseReturn.promise; return { done: true as const, value: undefined }; },
    };
    const capability = { consumerClosed: consumer.signal, async write() { assert.equal(this, capability); writes++; enteredWrite.resolve(); await releaseWrite.promise; } };
    Object.assign(setup.context, { stdin: { [Symbol.asyncIterator]() { return iterator; } }, stdout: { async write() { assert.fail('opaque stdout route'); }, ownedOutput: capability } });
    const execution = setup.run();
    void execution.then(() => { settled = true; }, () => { settled = true; });
    try {
      await enteredWrite.promise;
      consumer.abort(reason);
      await setImmediate();
      assert.equal(setup.caller.signal.aborted, false);
      assert.equal(settled, false); assert.equal(returns, 0);
      releaseWrite.resolve();
      await enteredReturn.promise;
      await setImmediate();
      assert.equal(settled, false); assert.equal(writes, 1); assert.equal(pulls, 1); assert.equal(returns, 1);
      releaseReturn.resolve();
      await assert.rejects(execution, error => Object.is(error, reason));
    } finally { releaseWrite.resolve(); releaseReturn.resolve(); await execution.catch(() => {}); }
  });

  test(`caller checkpoint consumer closure prevents next pull: ${JSON.stringify(reason)}`, async () => {
    const setup = fixture();
    const consumer = new AbortController();
    let checkpoints = 0, extraPulls = 0, returns = 0, writes = 0;
    registerYieldCheckpoint(setup.caller.signal, () => { checkpoints++; consumer.abort(reason); });
    Object.assign(setup.context, {
      args: ['-C', '-s10000'],
      stdin: { async *[Symbol.asyncIterator]() { try { yield new Uint8Array(10000); extraPulls++; yield Uint8Array.of(65); } finally { returns++; } } },
      stdout: { async write() { assert.fail('opaque stdout route'); }, ownedOutput: { consumerClosed: consumer.signal, async write() { writes++; } } },
    });
    await assert.rejects(setup.run(), error => Object.is(error, reason));
    assert.equal(setup.caller.signal.aborted, false);
    assert.equal(checkpoints, 1); assert.equal(extraPulls, 0); assert.equal(returns, 1); assert.equal(writes, 0);
  });
}

test('consumer signal getter is captured once with its capability receiver', async () => {
  const setup = fixture();
  const live = new AbortController(), closed = new AbortController();
  closed.abort(false);
  let reads = 0, writes = 0;
  const capability = { get consumerClosed() { assert.equal(this, capability); return ++reads === 1 ? live.signal : closed.signal; }, async write() { assert.equal(this, capability); writes++; } };
  Object.assign(setup.context, { stdout: { async write() { assert.fail('opaque stdout route'); }, ownedOutput: capability } });
  assert.equal((await setup.run()).exitCode, 0);
  assert.equal(reads, 1); assert.equal(writes, 2);
});

for (const boundary of ['failure-hook', 'cleanup-registration']) test(`${boundary} getter consumer closure prevents args acquisition`, async () => {
  const setup = fixture();
  const consumer = new AbortController();
  let args = 0, registrations = 0;
  const stdout: ByteSink = { async write() {}, ownedOutput: { consumerClosed: consumer.signal, async write() {} } };
  Object.defineProperty(setup.context, 'args', { get() { args++; return ['-C']; } });
  Object.assign(setup.context, { stdout });
  if (boundary === 'failure-hook') Object.defineProperty(stdout, outputFailure, { get() { consumer.abort(false); return undefined; } });
  else Object.defineProperty(setup.context, 'registerCleanup', { get() { consumer.abort(false); return () => { registrations++; }; } });
  await assert.rejects(setup.run(), error => error === false);
  assert.equal(args, 0); assert.equal(registrations, 0); assert.equal(setup.pulls, 0);
});

for (const reason of [false, 0, '', null]) {
  test(`unused closed stderr is never acquired: ${JSON.stringify(reason)}`, async () => {
    const setup = fixture();
    const consumer = new AbortController();
    consumer.abort(reason);
    let reads = 0;
    Object.defineProperty(setup.context, 'stderr', { get() {
      reads++;
      return { async write() { assert.fail('unused stderr'); }, ownedOutput: {
        consumerClosed: consumer.signal, async write() { assert.fail('unused capability'); },
      } };
    } });
    assert.equal((await setup.run()).exitCode, 0);
    assert.equal(reads, 0);
    assert.equal(setup.caller.signal.aborted, false);
  });

  for (const origin of ['caller', 'stderr', 'stdout'] as const) {
    test(`held diagnostic drains after ${origin} closes: ${JSON.stringify(reason)}`, async () => {
      const setup = fixture();
      const diagnostic = new AbortController(), stdout = new AbortController();
      const entered = deferred(), release = deferred();
      let settled = false, writes = 0;
      const capability = { consumerClosed: diagnostic.signal, async write() {
        assert.equal(this, capability); writes++; entered.resolve(); await release.promise;
      } };
      Object.assign(setup.context, { args: ['-e', 'unused'],
        stdout: { async write() { assert.fail('unexpected stdout'); }, ownedOutput: {
          consumerClosed: stdout.signal, async write() { assert.fail('unexpected stdout'); },
        } },
        stderr: { async write() { assert.fail('opaque diagnostic route'); }, ownedOutput: capability },
      });
      const execution = setup.run();
      void execution.then(() => { settled = true; }, () => { settled = true; });
      try {
        await entered.promise;
        if (origin === 'caller') { diagnostic.abort('secondary'); setup.caller.abort(reason); }
        else if (origin === 'stderr') diagnostic.abort(reason);
        else stdout.abort(reason);
        await setImmediate();
        assert.equal(settled, false);
        assert.equal(setup.caller.signal.aborted, origin === 'caller');
        assert.equal(stdout.signal.aborted, origin === 'stdout');
        assert.equal(diagnostic.signal.aborted, origin !== 'stdout');
        release.resolve();
        await assert.rejects(execution, error => Object.is(error, reason));
        assert.equal(writes, 1); assert.equal(setup.pulls, 0);
      } finally { release.resolve(); await execution.catch(() => {}); }
    });
  }

  for (const origin of ['stderr', 'stdout'] as const) {
    test(`diagnostic write getter closes only ${origin}: ${JSON.stringify(reason)}`, async () => {
      const setup = fixture();
      const diagnostic = new AbortController(), stdout = new AbortController();
      const release = deferred();
      let writes = 0, settled = false;
      const capability = { consumerClosed: diagnostic.signal, get write() {
        assert.equal(this, capability);
        (origin === 'stderr' ? diagnostic : stdout).abort(reason);
        return async function(this: unknown) {
          assert.equal(this, capability); writes++; await release.promise;
        };
      } };
      Object.assign(setup.context, { args: ['-e', 'unused'],
        stdout: { async write() {}, ownedOutput: { consumerClosed: stdout.signal, async write() {} } },
        stderr: { async write() { assert.fail('opaque diagnostic route'); }, ownedOutput: capability },
      });
      const execution = setup.run();
      void execution.then(() => { settled = true; }, () => { settled = true; });
      try {
        await setImmediate();
        assert.equal(writes, origin === 'stdout' ? 1 : 0);
        if (origin === 'stdout') assert.equal(settled, false);
        assert.equal(setup.caller.signal.aborted, false);
        assert.equal(diagnostic.signal.aborted, origin === 'stderr');
        release.resolve();
        await assert.rejects(execution, error => Object.is(error, reason));
      } finally { release.resolve(); await execution.catch(() => {}); }
    });
  }
}

for (const boundary of ['stderr', 'ownedOutput', 'consumerClosed'] as const) {
  test(`diagnostic ${boundary} snapshot survives later closed replacement`, async () => {
    const setup = fixture();
    const live = new AbortController(), closed = new AbortController();
    closed.abort(false);
    let reads = 0, writes = 0;
    await setup.context.fs.writeFile('/good', Uint8Array.of(65));
    Object.assign(setup.context, { args: ['-C', '/missing-one', '/missing-two', '/good'] });
    const replacement = { consumerClosed: closed.signal, async write() { assert.fail('replacement diagnostic'); } };
    const capability = { consumerClosed: live.signal, async write() { assert.equal(this, capability); writes++; } };
    const sink = { async write() { assert.fail('opaque diagnostic route'); }, ownedOutput: capability };
    if (boundary === 'stderr') Object.defineProperty(setup.context, 'stderr', { get() {
      assert.equal(this, setup.context); return ++reads === 1 ? sink : { ...sink, ownedOutput: replacement };
    } });
    else {
      Object.assign(setup.context, { stderr: sink });
      if (boundary === 'ownedOutput') Object.defineProperty(sink, 'ownedOutput', { get() {
        assert.equal(this, sink); return ++reads === 1 ? capability : replacement;
      } });
      else Object.defineProperty(capability, 'consumerClosed', { get() {
        assert.equal(this, capability); return ++reads === 1 ? live.signal : closed.signal;
      } });
    }
    assert.equal((await setup.run()).exitCode, 1);
    assert.equal(reads, 1); assert.equal(writes, 2);
    assert.equal(setup.caller.signal.aborted, false);
  });
}

for (const reporting of [new Error('reporting failure'), false, 0, '', null]) {
  for (const boundary of ['write', 'getter'] as const) {
    test(`unrelated ${boundary} failure is not inferred as consumer cancellation: ${String(reporting)}`, async () => {
      const setup = fixture();
      const diagnostic = new AbortController();
      const capability = { consumerClosed: diagnostic.signal, async write() {
        diagnostic.abort(false); throw reporting;
      } };
      if (boundary === 'getter') Object.defineProperty(capability, 'write', { get() {
        diagnostic.abort(false); throw reporting;
      } });
      Object.assign(setup.context, { args: ['-e', 'unused'], stderr: {
        async write() { assert.fail('opaque diagnostic route'); }, ownedOutput: capability,
      } });
      await assert.rejects(setup.run(), error => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.message, 'hexdump failure reporting failed');
        assert.equal(error.errors.length, 2);
        assert.ok(error.errors[0] instanceof Error);
        assert.ok(Object.is(error.errors[1], reporting));
        return true;
      });
      assert.equal(setup.caller.signal.aborted, false);
    });
  }
}

for (const outcome of ['eof', 'reader-failure'] as const) {
  for (const heldReturn of [false, true]) {
    test(`registered close blocks new diagnostics after ${outcome}, held return ${heldReturn}`, async () => {
      const { FsError } = await import('../../../src/contracts/index.js');
      const setup = fixture();
      const enteredReturn = deferred(), releaseReturn = deferred();
      let close: InvocationCleanup | undefined, closure: Promise<void> | undefined;
      let reads = 0, writes = 0, pulls = 0, returns = 0, settled = false;
      const iterator = {
        async next() {
          assert.equal(this, iterator);
          pulls++;
          assert.ok(close);
          closure = Promise.resolve(close());
          if (outcome === 'reader-failure') throw new FsError('EIO', { path: 'stdin' });
          return { done: true as const, value: undefined };
        },
        async return() {
          assert.equal(this, iterator);
          returns++;
          enteredReturn.resolve();
          if (heldReturn) await releaseReturn.promise;
          return { done: true as const, value: undefined };
        },
      };
      Object.assign(setup.context, {
        registerCleanup(cleanup: InvocationCleanup) { assert.equal(this, setup.context); close = cleanup; },
        stdin: { [Symbol.asyncIterator]() { return iterator; } },
      });
      Object.defineProperty(setup.context, 'stderr', { get() {
        reads++;
        return { async write() { writes++; } };
      } });
      const execution = setup.run();
      void execution.then(() => { settled = true; }, () => { settled = true; });
      try {
        await enteredReturn.promise;
        if (heldReturn) {
          await setImmediate();
          assert.equal(settled, false);
        }
        assert.equal(reads, 0, 'closed lifecycle must not acquire a new diagnostic destination');
        assert.equal(writes, 0, 'closed lifecycle must not admit a new diagnostic write');
        releaseReturn.resolve();
        await assert.rejects(execution, error => {
          assert.ok(error instanceof AggregateError);
          assert.equal(error.message, 'hexdump failure reporting failed');
          assert.equal(error.errors.length, 2);
          for (const cause of error.errors) {
            assert.ok(cause instanceof Error);
            assert.equal(cause.message, 'command is closed');
          }
          return true;
        });
        assert.equal(pulls, 1); assert.equal(returns, 1);
        assert.equal(setup.caller.signal.aborted, false);
      } finally {
        releaseReturn.resolve();
        await execution.catch(() => {});
        await closure;
      }
    });
  }
}
