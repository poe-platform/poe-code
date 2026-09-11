import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { type CommandContext, type InvocationCleanup } from '../../../src/contracts/index.js';
import { MemoryFileSystem } from '../../../src/fs/memory/index.js';
import { createDos2unixCommand } from '../../../src/commands/line-endings/index.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  const caller = new AbortController(), cleanups: InvocationCleanup[] = [];
  let pulls = 0;
  const context: CommandContext = {
    command: 'dos2unix', args: ['--unsupported'], cwd: '/', env: { LC_ALL: 'C' }, fs: new MemoryFileSystem(), signal: caller.signal,
    stdin: { async *[Symbol.asyncIterator]() { pulls++; yield Uint8Array.of(65, 13, 10); } },
    stdout: { async write() {} }, stderr: { async write() {} },
    registerCleanup(cleanup) { assert.equal(this, context); cleanups.push(cleanup); },
  };
  return { context, caller, get pulls() { return pulls; }, close() {
    assert.equal(cleanups.length, 1); return Promise.resolve(cleanups[0]!());
  }, async run() {
    try { return await createDos2unixCommand().execute(context); }
    finally { for (const cleanup of cleanups) await cleanup(); }
  } };
}

for (const reason of [false, 0, '', null]) {
  test(`preclosed diagnostic consumer refuses admission: ${JSON.stringify(reason)}`, async () => {
    const setup = fixture(), consumer = new AbortController(); consumer.abort(reason);
    let writes = 0;
    Object.assign(setup.context, { stderr: { async write() { assert.fail('opaque route'); }, ownedOutput: {
      consumerClosed: consumer.signal, async write() { writes++; },
    } } });
    let failure: { reason: unknown } | undefined;
    try { await setup.run(); } catch (error) { failure = { reason: error }; }
    assert.equal(writes, 0); assert.ok(failure); assert.ok(Object.is(failure.reason, reason));
    assert.equal(setup.caller.signal.aborted, false); assert.equal(setup.pulls, 0);
  });

  test(`unused closed diagnostic destination stays unobserved: ${JSON.stringify(reason)}`, async () => {
    const setup = fixture(), consumer = new AbortController(); consumer.abort(reason);
    let reads = 0;
    Object.assign(setup.context, { args: [] });
    Object.defineProperty(setup.context, 'stderr', { get() {
      reads++; return { async write() { assert.fail('unused'); }, ownedOutput: { consumerClosed: consumer.signal, async write() { assert.fail('unused'); } } };
    } });
    assert.equal((await setup.run()).exitCode, 0); assert.equal(reads, 0);
  });

  test(`cooperative stdout write drains after caller cancellation: ${JSON.stringify(reason)}`, async () => {
    const setup = fixture(), entered = deferred(), release = deferred();
    let settled = false, writes = 0;
    const capability = { consumerClosed: new AbortController().signal, async write() {
      assert.equal(this, capability); writes++; entered.resolve(); await release.promise;
    } };
    Object.assign(setup.context, { args: [], stdout: { async write() { assert.fail('opaque route'); }, ownedOutput: capability } });
    const execution = setup.run();
    void execution.then(() => { settled = true; }, () => { settled = true; });
    try {
      await entered.promise; setup.caller.abort(reason); await setImmediate();
      assert.equal(settled, false); release.resolve();
      await assert.rejects(execution, error => Object.is(error, reason)); assert.equal(writes, 1);
    } finally { release.resolve(); await execution.catch(() => {}); }
  });

  for (const origin of ['caller', 'stderr', 'stdout'] as const) {
    test(`held diagnostic drains after ${origin} closes: ${JSON.stringify(reason)}`, async () => {
      const setup = fixture(), diagnostic = new AbortController(), stdout = new AbortController();
      const entered = deferred(), release = deferred();
      let writes = 0, settled = false;
      const capability = { consumerClosed: diagnostic.signal, async write() {
        assert.equal(this, capability); writes++; entered.resolve(); await release.promise;
      } };
      Object.assign(setup.context, {
        stdout: { async write() {}, ownedOutput: { consumerClosed: stdout.signal, async write() { assert.fail('stdout'); } } },
        stderr: { async write() { assert.fail('opaque diagnostic route'); }, ownedOutput: capability },
      });
      const execution = setup.run();
      void execution.then(() => { settled = true; }, () => { settled = true; });
      try {
        await entered.promise;
        if (origin === 'caller') { diagnostic.abort('secondary'); setup.caller.abort(reason); }
        else (origin === 'stderr' ? diagnostic : stdout).abort(reason);
        await setImmediate(); assert.equal(settled, false);
        assert.equal(setup.caller.signal.aborted, origin === 'caller');
        assert.equal(diagnostic.signal.aborted, origin !== 'stdout');
        assert.equal(stdout.signal.aborted, origin === 'stdout');
        release.resolve(); await assert.rejects(execution, error => Object.is(error, reason));
        assert.equal(writes, 1); assert.equal(setup.pulls, 0);
      } finally { release.resolve(); await execution.catch(() => {}); }
    });
  }

  for (const origin of ['stderr', 'stdout'] as const) {
    test(`diagnostic write getter closes ${origin}: ${JSON.stringify(reason)}`, async () => {
      const setup = fixture(), diagnostic = new AbortController(), stdout = new AbortController();
      const release = deferred();
      let writes = 0, settled = false;
      const capability = { consumerClosed: diagnostic.signal, get write() {
        assert.equal(this, capability); (origin === 'stderr' ? diagnostic : stdout).abort(reason);
        return async function(this: unknown) { assert.equal(this, capability); writes++; await release.promise; };
      } };
      Object.assign(setup.context, {
        stdout: { async write() {}, ownedOutput: { consumerClosed: stdout.signal, async write() {} } },
        stderr: { async write() { assert.fail('opaque route'); }, ownedOutput: capability },
      });
      const execution = setup.run();
      void execution.then(() => { settled = true; }, () => { settled = true; });
      try {
        await setImmediate(); assert.equal(writes, origin === 'stdout' ? 1 : 0);
        if (origin === 'stdout') assert.equal(settled, false);
        assert.equal(setup.caller.signal.aborted, false);
        assert.equal(diagnostic.signal.aborted, origin === 'stderr');
        release.resolve(); await assert.rejects(execution, error => Object.is(error, reason));
      } finally { release.resolve(); await execution.catch(() => {}); }
    });
  }
}

for (const boundary of ['stderr', 'ownedOutput', 'consumerClosed'] as const) {
  test(`diagnostic ${boundary} is captured once across warnings`, async () => {
    const setup = fixture(), live = new AbortController(), closed = new AbortController(); closed.abort(false);
    let reads = 0, writes = 0;
    Object.assign(setup.context, { args: ['/missing'] });
    const capability = { consumerClosed: live.signal, async write() { assert.equal(this, capability); writes++; } };
    const replacement = { consumerClosed: closed.signal, async write() { assert.fail('replacement'); } };
    const sink = { async write() { assert.fail('opaque route'); }, ownedOutput: capability };
    if (boundary === 'stderr') Object.defineProperty(setup.context, 'stderr', { get() { return ++reads === 1 ? sink : { ...sink, ownedOutput: replacement }; } });
    else {
      Object.assign(setup.context, { stderr: sink });
      if (boundary === 'ownedOutput') Object.defineProperty(sink, 'ownedOutput', { get() { assert.equal(this, sink); return ++reads === 1 ? capability : replacement; } });
      else Object.defineProperty(capability, 'consumerClosed', { get() { assert.equal(this, capability); return ++reads === 1 ? live.signal : closed.signal; } });
    }
    assert.equal((await setup.run()).exitCode, 2); assert.equal(writes, 2); assert.equal(reads, 1);
  });
}

for (const reporting of [new Error('unrelated reporting'), false, 0, '', null]) {
  for (const boundary of ['write', 'getter'] as const) {
    test(`coincident abort does not replace unrelated ${boundary} failure ${String(reporting)}`, async () => {
      const setup = fixture(), diagnostic = new AbortController();
      const capability = { consumerClosed: diagnostic.signal, async write() { diagnostic.abort(false); throw reporting; } };
      if (boundary === 'getter') Object.defineProperty(capability, 'write', { get() { diagnostic.abort(false); throw reporting; } });
      Object.assign(setup.context, { stderr: { async write() { assert.fail('opaque route'); }, ownedOutput: capability } });
      await assert.rejects(setup.run(), error => {
        assert.ok(error instanceof AggregateError); assert.equal(error.message, 'line-ending failure reporting failed');
        assert.equal(error.errors.length, 2); assert.ok(error.errors[0] instanceof Error);
        assert.ok(Object.is(error.errors[1], reporting)); return true;
      });
      assert.equal(setup.caller.signal.aborted, false);
    });
  }
}

for (const heldReturn of [false, true]) {
  test(`registered close blocks new diagnostics but drains iterator return ${heldReturn}`, async () => {
    const setup = fixture(), entered = deferred(), release = deferred();
    let reads = 0, writes = 0, returns = 0, settled = false, closure: Promise<void> | undefined;
    const iterator = {
      async next() { closure = setup.close(); return { done: true as const, value: undefined }; },
      async return() { returns++; entered.resolve(); if (heldReturn) await release.promise; return { done: true as const, value: undefined }; },
    };
    Object.assign(setup.context, { args: [], stdin: { [Symbol.asyncIterator]() { return iterator; } } });
    Object.defineProperty(setup.context, 'stderr', { get() { reads++; return { async write() { writes++; } }; } });
    const execution = setup.run();
    void execution.then(() => { settled = true; }, () => { settled = true; });
    try {
      await entered.promise;
      if (heldReturn) { await setImmediate(); assert.equal(settled, false); }
      assert.equal(reads, 0); assert.equal(writes, 0); release.resolve();
      await assert.rejects(execution, error => error instanceof AggregateError);
      assert.equal(returns, 1); assert.equal(setup.caller.signal.aborted, false);
    } finally { release.resolve(); await execution.catch(() => {}); await closure; }
  });
}
