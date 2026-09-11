import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createFactorCommand, type FactorLimits } from "../../../src/commands/factor/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { toByteSource, type ByteSource, type ByteSink, type CommandContext } from "../../../src/contracts/index.js";

async function direct(overrides: Partial<CommandContext>, limits: Partial<FactorLimits> = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createFactorCommand({ limits }).execute({
    command: "factor", args: [], cwd: "/", env: { LC_ALL: "C" }, fs: new MemoryFileSystem(),
    signal: new AbortController().signal, stdin: toByteSource("12"),
    stdout: { async write(value) { stdout.push(Uint8Array.from(value)); } },
    stderr: { async write(value) { stderr.push(Uint8Array.from(value)); } }, ...overrides,
  });
  return { status: result.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

for (const phase of ["factory", "next"] as const) for (const reason of [false, 0, "", null]) {
  test(`direct input ${phase} getter cancellation blocks method admission ${JSON.stringify(reason)}`, async () => {
    const caller = new AbortController();
    let factories = 0, reads = 0, returned = 0;
    const iterator: AsyncIterator<Uint8Array> = {
      get next() {
        if (phase === "next") caller.abort(reason);
        return async () => { reads++; return { done: false, value: Buffer.from("12 ") }; };
      },
      async return() { returned++; return { done: true, value: undefined }; },
    };
    const stdin: ByteSource = {
      get [Symbol.asyncIterator]() {
        if (phase === "factory") caller.abort(reason);
        return () => { factories++; return iterator; };
      },
    };
    await assert.rejects(direct({ stdin, signal: caller.signal }), error => Object.is(error, reason));
    assert.deepEqual({ factories, reads, returned }, phase === "factory" ? { factories: 0, reads: 0, returned: 0 } : { factories: 1, reads: 0, returned: 1 });
  });
}

for (const phase of ["capability", "write"] as const) for (const reason of [false, 0, "", null]) {
  test(`direct stderr ${phase} getter cancellation blocks write admission ${JSON.stringify(reason)}`, async () => {
    const caller = new AbortController();
    let writes = 0;
    const capability = {
      consumerClosed: new AbortController().signal,
      get write() {
        if (phase === "write") caller.abort(reason);
        return async () => { writes++; };
      },
    };
    const stderr: ByteSink = {
      async write() { assert.fail("opaque output route"); },
      get ownedOutput() {
        if (phase === "capability") caller.abort(reason);
        return capability;
      },
    };
    await assert.rejects(direct({ args: ["bad"], stderr, signal: caller.signal }), error => Object.is(error, reason));
    assert.equal(writes, 0);
  });
}

for (const limit of ["maxInputBytes", "maxBufferedBytes", "maxWork"] as const) {
  test(`oversized source ${limit} admission happens before ownership copy`, async context => {
    const chunk = new Uint8Array(4096).fill(49);
    let pulls = 0, returned = 0, copies = 0;
    const original = Uint8Array.from;
    context.mock.method(Uint8Array, "from", function (source: Iterable<number> | ArrayLike<number>, map?: (value: number, index: number) => number, receiver?: unknown) {
      if (source === chunk) copies++;
      return Reflect.apply(original, Uint8Array, [source, map, receiver]) as Uint8Array;
    });
    const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() { pulls++; return { done: false, value: chunk }; },
      async return() { returned++; return { done: true, value: undefined }; },
    }; } };
    const result = await direct({ stdin }, { [limit]: 2048 });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.deepEqual({ copies, pulls, returned }, { copies: 0, pulls: 1, returned: 1 });
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

for (const reason of [false, 0, "", null, "dispose"]) {
  test(`actual Shell command-supplied source retains pending read and delayed return ${JSON.stringify(reason)}`, async () => {
    const caller = new AbortController();
    const entered = deferred(), gate = deferred(), closing = deferred(), closeGate = deferred();
    let reads = 0, returned = 0, completed = false, settled = false, disposed = false;
    const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() { reads++; entered.resolve(); await gate.promise; completed = true; return { done: false, value: Buffer.from("12 ") }; },
      async return() { returned++; closing.resolve(); await closeGate.promise; return { done: true, value: undefined }; },
    }; } };
    const shell = new Shell({ fs: new MemoryFileSystem() });
    const command = createFactorCommand();
    shell.commands.register({ ...command, execute(context) { return command.execute({ ...context, stdin }); } });
    let signal: AbortSignal | undefined;
    shell.use(async (context, next) => { signal = context.signal; return next(); });
    const execution = shell.exec("factor", { signal: caller.signal });
    void execution.then(() => { settled = true; }, () => { settled = true; });
    let disposal: Promise<void> | undefined;
    try {
      await Promise.race([entered.promise, execution.then(() => assert.fail("source not admitted"))]);
      if (reason === "dispose") {
        disposal = shell.dispose();
        void disposal.then(() => { disposed = true; }, () => { disposed = true; });
      } else caller.abort(reason);
      for (let turn = 0; turn < 12; turn++) await setImmediate();
      assert.deepEqual({ completed, settled, disposed, reads, returned }, { completed: false, settled: false, disposed: false, reads: 1, returned: 0 });
      gate.resolve();
      await closing.promise;
      for (let turn = 0; turn < 12; turn++) await setImmediate();
      assert.deepEqual({ completed, settled, disposed, reads, returned }, { completed: true, settled: false, disposed: false, reads: 1, returned: 1 });
      const expected = reason === "dispose" ? signal!.reason : reason;
      closeGate.resolve();
      await assert.rejects(execution, error => Object.is(error, expected));
      await disposal;
    } finally { gate.resolve(); closeGate.resolve(); await execution.catch(() => {}); await shell.dispose(); }
  });
}

test("all uint32 factor records in a bounded product family preserve exact multiplicity", async () => {
  const operands: string[] = [], records: string[] = [];
  for (let twos = 0; twos < 6; twos++) for (let threes = 0; threes < 4; threes++) for (let fives = 0; fives < 3; fives++) {
    const value = 2 ** twos * 3 ** threes * 5 ** fives;
    operands.push(String(value));
    records.push(`${value}:${" 2".repeat(twos)}${" 3".repeat(threes)}${" 5".repeat(fives)}\n`);
  }
  assert.deepEqual(await direct({ args: operands }), { status: 0, stdout: records.join(""), stderr: "" });
});

