import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createFactorCommand, factorCommands, type FactorLimits } from "../../../src/commands/factor/index.js";
import { createCommandArguments, FsError, toByteSource, type ByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { shellValueFromBytes } from "../../../src/contracts/value.js";

async function run(args: string[], limits: Partial<FactorLimits>, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createFactorCommand({ limits }).execute({
    command: "factor", args, cwd: "/", env: { LC_ALL: "C" }, fs: new MemoryFileSystem(),
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write(value) { stdout.push(Uint8Array.from(value)); } },
    stderr: { async write(value) { stderr.push(Uint8Array.from(value)); } }, ...overrides,
  });
  return { status: result.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

test("intentional lowered magnitude cap still admits zero and canonical one", async () => {
  assert.deepEqual(await run(["0", "+0001", "2", "1"], { maxValue: 1 }), {
    status: 1, stdout: "0:\n1:\n1:\n", stderr: "factor: '2' exceeds supported maximum 1\n",
  });
});

test("intentional uint32 cap is distinct from syntax errors and NUL suffix accounting", async () => {
  const stdin = toByteSource("0004294967296\0x 4294967296x\0ignored 12");
  assert.deepEqual(await run([], {}, { stdin }), {
    status: 1, stdout: "12: 2 2 3\n",
    stderr: "factor: '0004294967296' exceeds supported maximum 4294967295\nfactor: '4294967296x' is not a valid positive integer\n",
  });
});

test("large supported-prime work is cumulative without publishing uncompleted records", async () => {
  const options = { maxWork: 40_000 };
  assert.deepEqual(await run(["4294967291"], options), { status: 0, stdout: "4294967291: 4294967291\n", stderr: "" });
  assert.deepEqual(await run(["4294967291", "4294967291"], options), { status: 1, stdout: "", stderr: "factor: work limit exceeded\n" });
});

for (const raw of [false, true]) {
  test(`actual invoke admits UTF-8 bytes before command input acquisition, raw=${raw}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() });
    const command = createFactorCommand({ limits: { maxArgumentBytes: 1 } });
    const stdin: ByteSource = { [Symbol.asyncIterator]() { assert.fail("argument rejection must precede command input acquisition"); } };
    shell.commands.register({ ...command, execute(context) { return command.execute({ ...context, stdin }); } });
    shell.commands.register({ name: "forward", execute(context) {
      if (!raw) return context.invoke!("factor", ["é"]);
      const carrier = createCommandArguments([shellValueFromBytes(Uint8Array.of(195, 169))]);
      return context.invoke!("factor", carrier.args, { argumentValues: carrier });
    } });
    try {
      const result = await shell.exec("forward");
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
        status: 1, stdout: "", stderr: "factor: argument bytes limit exceeded\n",
      });
    } finally { await shell.dispose(); }
  });
}

test("diagnostic allowance is cumulative and publishes no partial second quote", async () => {
  const expected = "factor: 'bad' is not a valid positive integer\n";
  const written: Uint8Array[] = [];
  await assert.rejects(run(["bad", "bad"], { maxDiagnosticBytes: expected.length }, {
    stderr: { async write(value) { written.push(Uint8Array.from(value)); } },
  }), AggregateError);
  assert.equal(Buffer.concat(written).toString(), expected);
});

test("output cap preserves earlier complete native-style batches only", async () => {
  const input = "0 ".repeat(172);
  const result = await run([], { maxOutputBytes: 514 }, { stdin: toByteSource(input) });
  assert.deepEqual(result, { status: 1, stdout: "0:\n".repeat(170), stderr: "factor: output bytes limit exceeded\n" });
});

test("output cap before the first flush discards unadmitted pending records", async () => {
  assert.deepEqual(await run([], { maxOutputBytes: 511 }, { stdin: toByteSource("0 ".repeat(171)) }), {
    status: 1, stdout: "", stderr: "factor: output bytes limit exceeded\n",
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("source-derived batching publishes a full batch before EOF but retains the final row", async () => {
  const entered = deferred(), gate = deferred();
  const writes: Uint8Array[] = [];
  let pulls = 0, settled = false;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() {
      if (++pulls === 1) return { done: false, value: Buffer.from("0 ".repeat(171)) };
      entered.resolve(); await gate.promise;
      return { done: true, value: undefined };
    },
  }; } };
  const execution = run([], {}, { stdin, stdout: { async write(value) { writes.push(Uint8Array.from(value)); } } });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered.promise;
    for (let turn = 0; turn < 12; turn++) await setImmediate();
    assert.equal(settled, false);
    assert.deepEqual(writes.map(value => value.length), [510]);
    gate.resolve();
    assert.equal((await execution).status, 0);
    assert.deepEqual(writes.map(value => value.length), [510, 3]);
  } finally { gate.resolve(); await execution.catch(() => {}); }
});

test("explicit read failure preserves prior batches and discards unfinished tokens and buffered rows", async () => {
  let pulls = 0, returned = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() {
      if (++pulls === 1) return { done: false, value: Buffer.from("0 ".repeat(171) + "7") };
      throw new FsError("EIO");
    },
    async return() { returned++; return { done: true, value: undefined }; },
  }; } };
  assert.deepEqual(await run([], {}, { stdin }), { status: 1, stdout: "0:\n".repeat(170), stderr: "factor: standard input: Input/output error\n" });
  assert.deepEqual({ pulls, returned }, { pulls: 2, returned: 1 });
});

for (const destination of ["stdout", "stderr"] as const) for (const reason of [false, 0, "", null, "dispose"]) {
  test(`actual Shell drains faithful ${destination} before caller completion ${JSON.stringify(reason)}`, async () => {
    const entered = deferred(), gate = deferred();
    const caller = new AbortController();
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(factorCommands());
    let signal: AbortSignal | undefined;
    let completed = false, settled = false, disposed = false, writes = 0;
    shell.use(async (context, next) => { signal = context.signal; return next(); });
    const sink = {
      async write() { assert.fail("opaque output route"); },
      ownedOutput: { consumerClosed: new AbortController().signal, async write() {
        writes++; entered.resolve();
        try { await gate.promise; signal!.throwIfAborted(); }
        finally { completed = true; }
      } },
    };
    const execution = shell.exec(destination === "stdout" ? "factor 12 18" : "factor invalid second", { signal: caller.signal, [destination]: sink });
    void execution.then(() => { settled = true; }, () => { settled = true; });
    let disposal: Promise<void> | undefined;
    try {
      await Promise.race([entered.promise, execution.then(() => assert.fail("sink not admitted"))]);
      if (reason === "dispose") {
        disposal = shell.dispose();
        void disposal.then(() => { disposed = true; }, () => { disposed = true; });
      } else caller.abort(reason);
      for (let turn = 0; turn < 12; turn++) await setImmediate();
      assert.deepEqual({ completed, settled, disposed, writes }, { completed: false, settled: false, disposed: false, writes: 1 });
      const expected = reason === "dispose" ? signal!.reason : reason;
      gate.resolve();
      await assert.rejects(execution, error => Object.is(error, expected));
      assert.equal(completed, true);
      await disposal;
    } finally { gate.resolve(); await execution.catch(() => {}); await shell.dispose(); }
  });
}
