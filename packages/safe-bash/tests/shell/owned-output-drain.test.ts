import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { Shell } from "../../src/shell/shell.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Budget, resolveLimits } from "../../src/shell/runtime.js";
import { createOutputOperation, type ByteSink, type CommandContext } from "../../src/contracts/index.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(observe: (signal: AbortSignal) => void = () => {}) {
  const errors: unknown[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem(), onInternalError: error => { errors.push(error); } });
  shell.commands.register({ name: "writer", async execute(context: CommandContext) {
    let pending: Promise<void> | undefined;
    const destination = context.stdout;
    const tracked: ByteSink = {
      write(chunk) { pending = destination.write(chunk); return pending; },
      ...(destination.ownedOutput ? { ownedOutput: {
        consumerClosed: destination.ownedOutput.consumerClosed,
        write(chunk: Uint8Array) { pending = destination.ownedOutput!.write(chunk); return pending; },
      } } : {}),
    };
    const operation = createOutputOperation(context, tracked);
    operation.registerCleanup(async () => { await pending?.then(() => {}, () => {}); });
    observe(operation.signal);
    let failure: { reason: unknown } | undefined;
    try { await operation.output.write(Uint8Array.of(65, 0, 255, 10)); }
    catch (reason) { failure = { reason }; }
    await operation.close();
    context.signal.throwIfAborted();
    operation.signal.throwIfAborted();
    if (failure) throw failure.reason;
    return { exitCode: 0 };
  } });
  shell.commands.register({ name: "forward", execute(context) {
    return context.invoke!("writer", []);
  } });
  return { shell, errors };
}

async function turns(): Promise<void> {
  for (let index = 0; index < 8; index++) await setImmediate();
}

for (const owned of [true, false]) {
  test(`output operation drains only explicitly owned writes after cancellation: ${owned}`, async () => {
    const caller = new AbortController(), entered = deferred(), gate = deferred();
    let completed = false, closed = false;
    const write = async () => {
      entered.resolve();
      try { await gate.promise; throw new Error("late write failure"); }
      finally { completed = true; }
    };
    const operation = createOutputOperation({ signal: caller.signal }, {
      write,
      ...(owned ? { ownedOutput: { consumerClosed: new AbortController().signal, write } } : {}),
    });
    const writing = assert.rejects(operation.output.write(Uint8Array.of(65)), reason => reason === false);
    await entered.promise;
    caller.abort(false);
    const closing = operation.close().then(() => { closed = true; });
    try {
      await writing;
      await turns();
      assert.equal(closed, !owned);
      assert.equal(completed, false);
    } finally {
      gate.resolve();
      await closing;
      await turns();
    }
    assert.equal(completed, true);
  });
}

test("output operation closes all admitted writes and runs cleanup that releases them", async () => {
  const first = deferred(), second = deferred(), entered = deferred();
  let calls = 0, closed = false;
  const operation = createOutputOperation({ signal: new AbortController().signal }, {
    async write() { assert.fail("owned route required"); },
    ownedOutput: { consumerClosed: new AbortController().signal, async write() {
      if (++calls === 1) await first.promise;
      else { entered.resolve(); await second.promise; }
    } },
  });
  operation.registerCleanup(() => { first.resolve(); });
  const writes = [operation.output.write(Uint8Array.of(1)), operation.output.write(Uint8Array.of(2))];
  await entered.promise;
  const closing = operation.close().then(() => { closed = true; });
  try {
    await writes[0];
    await turns();
    assert.equal(closed, false);
    await assert.rejects(operation.output.write(Uint8Array.of(3)), /closed/);
    assert.equal(calls, 2);
  } finally {
    second.resolve();
    await Promise.all([...writes, closing]);
  }
});

test("output operation drains a write that closes its scope during admission", async () => {
  const gate = deferred();
  let closing: Promise<void> | undefined, closed = false;
  const operation = createOutputOperation({ signal: new AbortController().signal }, {
    async write() { assert.fail("owned route required"); },
    ownedOutput: { consumerClosed: new AbortController().signal, async write() {
      closing = operation.close().then(() => { closed = true; });
      await gate.promise;
    } },
  });
  const writing = operation.output.write(Uint8Array.of(65));
  try {
    assert.ok(closing);
    await turns();
    assert.equal(closed, false);
  } finally {
    gate.resolve();
    await Promise.all([writing, closing]);
  }
});

for (const command of ["writer", "forward"]) {
  for (const reason of [false, 0, "", null, "dispose"] as const) {
    test(`${command}: enrolled write drains before caller ${JSON.stringify(reason)}`, async () => {
      const entered = deferred(), gate = deferred();
      const caller = new AbortController();
      let signal: AbortSignal | undefined;
      let completed = false, settled = false, disposed = false, writes = 0;
      const { shell } = fixture(value => { signal = value; });
      const lateFailure = new Error("late enrolled write failure");
      const stdout: ByteSink = {
        async write() { assert.fail("enrolled writes must not use the opaque route"); },
        ownedOutput: { consumerClosed: new AbortController().signal, async write() {
          assert.ok(signal, "cleanup and operation signal must exist before write admission");
          writes++;
          entered.resolve();
          try { await gate.promise; throw lateFailure; }
          finally { completed = true; }
        } },
      };
      const execution = shell.exec(command, { signal: caller.signal, stdout });
      void execution.then(() => { settled = true; }, () => { settled = true; });
      let disposal: Promise<void> | undefined;
      try {
        await Promise.race([entered.promise, execution.then(() => assert.fail("write not admitted"))]);
        if (reason === "dispose") {
          disposal = shell.dispose();
          void disposal.then(() => { disposed = true; }, () => { disposed = true; });
        } else caller.abort(reason);
        await turns();
        assert.equal(signal?.aborted, true);
        assert.deepEqual({ completed, settled, disposed, writes }, { completed: false, settled: false, disposed: false, writes: 1 });
        gate.resolve();
        await assert.rejects(execution, error => Object.is(error, reason === "dispose" ? signal?.reason : reason));
        assert.equal(completed, true);
        if (disposal) await disposal;
        else assert.equal((await shell.exec(":" )).exitCode, 0);
      } finally { gate.resolve(); await execution.catch(() => {}); await shell.dispose(); }
    });
  }

  for (const reason of [false, 0, "", null]) {
    test(`${command}: consumer close drains enrolled write and retains ${JSON.stringify(reason)}`, async () => {
      const entered = deferred(), gate = deferred();
      const consumer = new AbortController();
      const caller = new AbortController();
      let signal: AbortSignal | undefined;
      let completed = false, settled = false, writes = 0;
      const { shell, errors } = fixture(value => { signal = value; });
      const execution = shell.exec(command, { signal: caller.signal, stdout: {
        async write() { assert.fail("enrolled writes must not use the opaque route"); },
        ownedOutput: { consumerClosed: consumer.signal, async write() {
          writes++;
          entered.resolve();
          try { await gate.promise; signal!.throwIfAborted(); }
          finally { completed = true; }
        } },
      } });
      void execution.then(() => { settled = true; }, () => { settled = true; });
      try {
        await Promise.race([entered.promise, execution.then(() => assert.fail("write not admitted"))]);
        consumer.abort(reason);
        await turns();
        assert.equal(signal?.aborted, true);
        assert.equal(caller.signal.aborted, false);
        assert.deepEqual({ completed, settled, writes }, { completed: false, settled: false, writes: 1 });
        gate.resolve();
        assert.equal((await execution).exitCode, 1);
        assert.equal(errors.length, 1);
        assert.equal(errors[0], reason);
        assert.equal(completed, true);
        assert.equal((await shell.exec(":" )).exitCode, 0);
      } finally { gate.resolve(); await execution.catch(() => {}); await shell.dispose(); }
    });
  }

  test(`${command}: owned success preserves bytes without duplicate budget charging`, async () => {
    const { shell } = fixture();
    const delivered: number[] = [];
    try {
      const result = await shell.exec(command, { limits: { maxOutputBytes: 4 }, stdout: {
        async write() { assert.fail("opaque output must not be called"); },
        ownedOutput: { consumerClosed: new AbortController().signal, async write(bytes) { delivered.push(...bytes); } },
      } });
      assert.equal(result.exitCode, 0);
      assert.deepEqual(delivered, [65, 0, 255, 10]);
      assert.deepEqual([...result.stdoutBytes], delivered);
    } finally { await shell.dispose(); }
  });

  test(`${command}: output budget refuses an owned write before delivery`, async () => {
    const { shell } = fixture();
    let writes = 0;
    try {
      await assert.rejects(shell.exec(command, { limits: { maxOutputBytes: 3 }, stdout: {
        async write() { assert.fail("opaque output must not be called"); },
        ownedOutput: { consumerClosed: new AbortController().signal, async write() { writes++; } },
      } }), error => error instanceof Error && error.message.includes("maxOutputBytes"));
      assert.equal(writes, 0);
    } finally { await shell.dispose(); }
  });
}

for (const reason of [new Error("enrolled rejection"), false, 0, "", null]) {
  test(`owned rejection without cancellation is reported: ${String(reason)}`, async () => {
    const { shell, errors } = fixture();
    try {
      const result = await shell.exec("writer", { stdout: {
        async write() { assert.fail("opaque output must not be called"); },
        ownedOutput: { consumerClosed: new AbortController().signal, async write() { throw reason; } },
      } });
      assert.equal(result.exitCode, 1);
      assert.equal(errors.length, 1);
      assert.equal(errors[0], reason);
    } finally { await shell.dispose(); }
  });
}

for (const reason of [false, 0, "", null, "dispose"] as const) {
  test(`opaque sink remains interruptible for ${JSON.stringify(reason)}`, async () => {
    const entered = deferred(), gate = deferred(), finished = deferred();
    const caller = new AbortController();
    let signal: AbortSignal | undefined;
    const { shell } = fixture(value => { signal = value; });
    let completed = false, settled = false;
    const execution = shell.exec("forward", { signal: caller.signal, stdout: { async write() {
      entered.resolve();
      try { await gate.promise; throw new Error("late opaque rejection"); }
      finally { completed = true; finished.resolve(); }
    } } });
    void execution.then(() => { settled = true; }, () => { settled = true; });
    try {
      await Promise.race([entered.promise, execution.then(() => assert.fail("write not admitted"))]);
      const disposal = reason === "dispose" ? shell.dispose() : undefined;
      if (reason !== "dispose") caller.abort(reason);
      await turns();
      assert.equal(settled, true, "opaque work must not indefinitely block cancellation");
      await assert.rejects(execution, error => Object.is(error, reason === "dispose" ? signal?.reason : reason));
      if (disposal) await disposal;
      assert.equal(completed, false, "opaque pending work must not block shell settlement");
      gate.resolve();
      await finished.promise;
      await turns();
    } finally { gate.resolve(); await execution.catch(() => {}); await shell.dispose(); }
  });
}

for (const branch of ["Budget.sink", "signalSink"]) {
  test(`${branch}: method getter cancellation prevents owned write admission`, async context => {
    const parent = new AbortController(), child = new AbortController();
    const budget = new Budget(resolveLimits({ maxOutputBytes: 4 }), parent.signal);
    context.after(() => budget.close());
    let writes = 0;
    const capability = { consumerClosed: new AbortController().signal, async write() { writes++; } };
    const sink: ByteSink = { async write() { assert.fail("opaque route must not be used"); }, ownedOutput: capability };
    let output: ByteSink;
    if (branch === "Budget.sink") {
      const write = capability.write;
      Object.defineProperty(capability, "write", { get() { parent.abort(false); return write; } });
      output = budget.sink(sink);
    } else {
      const first = budget.sink(sink);
      const write = first.ownedOutput!.write;
      Object.defineProperty(first.ownedOutput!, "write", { get() { child.abort(false); return write; } });
      output = budget.sink(first, child.signal);
    }
    await assert.rejects(output.ownedOutput!.write(Uint8Array.of(65, 0, 255, 10)), error => error === false);
    assert.equal(writes, 0);
    assert.equal(budget.bytes, 0);
  });
}

test("owned method lookup cannot overdraw a reentrantly consumed output budget", async context => {
  const budget = new Budget(resolveLimits({ maxOutputBytes: 4 }));
  context.after(() => budget.close());
  let outerWrites = 0, innerWrites = 0;
  let inner: Promise<void> | undefined;
  const capability = { consumerClosed: new AbortController().signal, async write() { outerWrites++; } };
  const write = capability.write;
  Object.defineProperty(capability, "write", { get() {
    const sink = budget.sink({ async write() { assert.fail("opaque route must not be used"); }, ownedOutput: {
      consumerClosed: new AbortController().signal, async write() { innerWrites++; },
    } });
    inner = sink.ownedOutput!.write(Uint8Array.of(1, 2, 3, 4));
    void inner.catch(() => {});
    return write;
  } });
  const output = budget.sink({ async write() { assert.fail("opaque route must not be used"); }, ownedOutput: capability });
  try {
    await assert.rejects(output.ownedOutput!.write(Uint8Array.of(5, 6, 7, 8)), error => error instanceof Error && error.message.includes("maxOutputBytes"));
    assert.deepEqual({ innerWrites, outerWrites, charged: budget.bytes }, { innerWrites: 1, outerWrites: 0, charged: 4 });
  } finally { await inner?.catch(() => {}); }
});

test("forwarded owned methods retain their capability receiver", async context => {
  const budget = new Budget(resolveLimits({ maxOutputBytes: 4 }));
  context.after(() => budget.close());
  let calls = 0;
  const capability = { consumerClosed: new AbortController().signal, async write() {
    assert.equal(this, capability);
    calls++;
  } };
  const output = budget.sink(budget.sink({ async write() { assert.fail("opaque route must not be used"); }, ownedOutput: capability }));
  await output.ownedOutput!.write(Uint8Array.of(1, 2, 3, 4));
  assert.equal(calls, 1);
  assert.equal(budget.bytes, 4);
});
