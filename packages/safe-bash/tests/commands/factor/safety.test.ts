import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { FsError, toByteSource, type ByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { printfCommand } from "../../../src/commands/basic.js";
import { createFactorCommand, createFactorCommands, factorCommands, type FactorCommandsOptions, type FactorLimits } from "../../../src/commands/factor/index.js";

async function run(args: string[] = [], input = "12 18", options: FactorCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createFactorCommand(options).execute({
    command: "factor", args, cwd: "/", env: { LC_ALL: "C" }, fs: new MemoryFileSystem(),
    signal: new AbortController().signal, stdin: toByteSource(input),
    stdout: { async write(value) { stdout.push(Uint8Array.from(value)); } },
    stderr: { async write(value) { stderr.push(Uint8Array.from(value)); } }, ...overrides,
  });
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("public factories register exactly one factor and preserve replacement policy", async () => {
  assert.deepEqual(createFactorCommands().map(command => command.name), ["factor"]);
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(factorCommands());
  try {
    await shell.exec(":");
    assert.throws(() => factorCommands().setup({ commands: shell.commands, use() {}, registerFileSystem() {} }));
    shell.use(factorCommands({ replace: true }));
    assert.equal((await shell.exec("factor 12")).stdout, "12: 2 2 3\n");
  } finally { await shell.dispose(); }
});

for (const limit of ["maxValue", "maxArguments", "maxArgumentBytes", "maxInputBytes", "maxTokenBytes", "maxNumbers", "maxBufferedBytes", "maxOutputBytes", "maxDiagnosticBytes", "maxWork", "maxEmptyChunks"] as const satisfies readonly (keyof FactorLimits)[]) {
  test(`invalid ${limit} rejected at factory construction`, () => {
    for (const value of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => createFactorCommand({ limits: { [limit]: value } }), RangeError);
  });
}

test("configured magnitude cannot expand beyond uint32", () => {
  assert.throws(() => createFactorCommand({ limits: { maxValue: 4_294_967_296 } }), RangeError);
});

test("cap boundary is explicit and later valid numbers still print", async () => {
  assert.deepEqual(await run(["4294967295", "4294967296", "12"]), {
    exitCode: 1, stdout: "4294967295: 3 5 17 257 65537\n12: 2 2 3\n",
    stderr: "factor: '4294967296' exceeds supported maximum 4294967295\n",
  });
});

test("a lowered cap rejects magnitude rather than digit count", async () => {
  assert.deepEqual(await run(["00000012", "  +12", "13"], "", { limits: { maxValue: 12 } }), {
    exitCode: 1, stdout: "12: 2 2 3\n12: 2 2 3\n", stderr: "factor: '13' exceeds supported maximum 12\n",
  });
});

test("help reports the configured magnitude", async () => {
  assert.ok((await run(["--help"], "", { limits: { maxValue: 100 } })).stdout.includes("Maximum supported value: 100\n"));
});

test("virtual help short-circuits operands and version prefixes are admitted", async () => {
  const help = await run(["12", "--he", "invalid"]);
  assert.equal(help.exitCode, 0);
  assert.ok(help.stdout.startsWith("Usage: factor"));
  assert.equal(help.stderr, "");
  assert.deepEqual(await run(["--v"]), { exitCode: 0, stdout: "factor (virtual-bash)\n", stderr: "" });
});

test("empty long-option prefix preserves native ambiguity and candidate order", async () => {
  assert.deepEqual(await run(["--=x"]), {
    exitCode: 1, stdout: "",
    stderr: "factor: option '--=x' is ambiguous; possibilities: '---debug' '--help' '--version'\nTry 'factor --help' for more information.\n",
  });
});

for (const [args, limits] of [[["12", "18"], { maxArguments: 1 }], [["12"], { maxArgumentBytes: 1 }]] as const) {
  test(`argv admission before stdin: ${JSON.stringify(limits)}`, async () => {
    const stdin: ByteSource = { [Symbol.asyncIterator]() { assert.fail("stdin acquired before argv rejection"); } };
    assert.equal((await run([...args], "", { limits }, { stdin })).exitCode, 1);
  });
}

test("diagnostics never publish a partial over-budget quote", async () => {
  const writes: Uint8Array[] = [];
  await assert.rejects(run(["bad"], "", { limits: { maxDiagnosticBytes: 8 } }, {
    stderr: { async write(value) { writes.push(Uint8Array.from(value)); } },
  }), AggregateError);
  assert.equal(writes.length, 0);
});

test("syntax validation wins over magnitude overflow", async () => {
  const input = "999999999999999999999999999999999999999999x";
  assert.deepEqual(await run([input]), { exitCode: 1, stdout: "", stderr: `factor: '${input}' is not a valid positive integer\n` });
});

test("numbers on argv never acquire stdin", async () => {
  const stdin: ByteSource = { [Symbol.asyncIterator]() { assert.fail("argv factoring acquired stdin"); } };
  assert.equal((await run(["12"], "", {}, { stdin })).stdout, "12: 2 2 3\n");
});

test("malformed JavaScript Unicode and NUL argv reject rather than repair", async () => {
  for (const input of ["\ud800", "\udfff", "12\0ignored"]) assert.equal((await run([input])).exitCode, 1);
});

test("actual Shell preserves raw invalid argv bytes in diagnostics", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: "C" } }).use(factorCommands());
  try {
    const result = await shell.exec("factor $'\\xff' 12");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "12: 2 2 3\n");
    assert.equal(result.stderr, "factor: '\\377' is not a valid positive integer\n");
  } finally { await shell.dispose(); }
});

for (const [input, limits, message] of [
  ["12 18", { maxInputBytes: 4 }, "input bytes"],
  ["00012", { maxTokenBytes: 4 }, "token bytes"],
  ["12\0ignored", { maxTokenBytes: 4 }, "token bytes"],
  ["1 2", { maxNumbers: 1 }, "numbers"],
  ["12", { maxBufferedBytes: 1200 }, "buffered bytes"],
  ["4294967291", { maxWork: 128 }, "work"],
  ["2147483648", { maxWork: 64 }, "work"],
  ["12", { maxOutputBytes: 9 }, "output bytes"],
] as const) test(`bounded ${message}: ${JSON.stringify(input)}`, async () => {
  const result = await run([], input, { limits });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes(`${message} limit exceeded`), result.stderr);
});

test("work allowance is cumulative across numbers", async () => {
  const options = { limits: { maxWork: 80 } };
  assert.equal((await run(["12"], "", options)).exitCode, 0);
  assert.equal((await run(["12", "12"], "", options)).exitCode, 1);
});

test("empty input fragments are bounded and returned", async () => {
  let reads = 0, returned = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { reads++; return { done: false, value: new Uint8Array() }; },
    async return() { returned++; return { done: true, value: undefined }; },
  }; } };
  assert.equal((await run([], "", { limits: { maxEmptyChunks: 2 } }, { stdin })).exitCode, 1);
  assert.deepEqual({ reads, returned }, { reads: 3, returned: 1 });
});

test("producer reuse at EOF cannot change retained token bytes", async () => {
  const fragment = Buffer.from("12 18");
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() { try { yield fragment; } finally { fragment.fill(88); } } };
  assert.equal((await run([], "", {}, { stdin })).stdout, "12: 2 2 3\n18: 2 3 3\n");
  assert.equal(fragment.toString(), "XXXXX");
});

for (const [input, sizes] of [["0 ".repeat(166) + "100", [511]], ["0 ".repeat(169) + "2", [512]], ["0 ".repeat(171), [510, 3]]] as const) {
  test(`source-derived complete-line batches: ${sizes.join(",")}`, async () => {
    const chunks: Uint8Array[] = [];
    const result = await run([], input, {}, { stdout: { async write(value) { chunks.push(Uint8Array.from(value)); } } });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(chunks.map(chunk => chunk.length), [...sizes]);
    assert.ok(chunks.every(chunk => chunk.at(-1) === 10 && chunk.length <= 512));
  });
}

test("owned stdout charges actual output exactly once", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(factorCommands());
  try {
    const result = await shell.exec("factor 12", { limits: { maxOutputBytes: 10 } });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "12: 2 2 3\n");
  } finally { await shell.dispose(); }
});

test("saved VFS script and pipeline use actual Shell dispatch", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/factor.sh", Buffer.from("printf '12 18' | factor\n"));
  const shell = new Shell({ fs }).use(factorCommands());
  shell.commands.register(printfCommand);
  try {
    const result = await shell.exec("sh /factor.sh");
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout: "12: 2 2 3\n18: 2 3 3\n", stderr: "" });
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["factor.sh"]);
  } finally { await shell.dispose(); }
});

test("VFS read failures are explicit rather than native unchecked stdio errors", async () => {
  let returned = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { throw new FsError("EIO"); },
    async return() { returned++; return { done: true, value: undefined }; },
  }; } };
  assert.deepEqual(await run([], "", {}, { stdin }), { exitCode: 1, stdout: "", stderr: "factor: standard input: Input/output error\n" });
  assert.equal(returned, 1);
});

test("primary input and cleanup failures both escape", async () => {
  const primary = new Error("input failure"), cleanup = new Error("return failure");
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { throw primary; },
    async return() { throw cleanup; },
  }; } };
  await assert.rejects(run([], "", {}, { stdin }), error => error instanceof AggregateError && error.errors[0] === primary && error.errors[1] === cleanup);
});

for (const reason of [false, 0, "", null]) {
  test(`consumer close drains admitted stdout and preserves ${JSON.stringify(reason)}`, async () => {
    const consumer = new AbortController();
    const entered = deferred(), gate = deferred();
    let settled = false, completed = false;
    const execution = run(["12"], "", {}, { stdout: {
      async write() { assert.fail("opaque stdout route"); },
      ownedOutput: { consumerClosed: consumer.signal, async write() { entered.resolve(); await gate.promise; completed = true; } },
    } });
    void execution.then(() => { settled = true; }, () => { settled = true; });
    try {
      await entered.promise;
      consumer.abort(reason);
      await setImmediate();
      assert.deepEqual({ completed, settled }, { completed: false, settled: false });
      gate.resolve();
      await assert.rejects(execution, error => Object.is(error, reason));
      assert.equal(completed, true);
    } finally { gate.resolve(); await execution.catch(() => {}); }
  });

  test(`arithmetic yields to caller cancellation ${JSON.stringify(reason)}`, async () => {
    const caller = new AbortController();
    const execution = run(["4294967291"], "", {}, { signal: caller.signal });
    const cancellation = setImmediate().then(() => { caller.abort(reason); });
    await assert.rejects(execution, error => Object.is(error, reason));
    await cancellation;
  });

  test(`synchronous stdin acquisition cancellation retains returned iterator ${JSON.stringify(reason)}`, async () => {
    const caller = new AbortController();
    let returned = 0, reads = 0;
    const stdin: ByteSource = { [Symbol.asyncIterator]() {
      caller.abort(reason);
      return {
        async next() { reads++; return { done: true, value: undefined }; },
        async return() { returned++; return { done: true, value: undefined }; },
      };
    } };
    await assert.rejects(run([], "", {}, { stdin, signal: caller.signal }), error => Object.is(error, reason));
    assert.deepEqual({ returned, reads }, { returned: 1, reads: 0 });
  });

  test(`held input drains before return after cancellation ${JSON.stringify(reason)}`, async () => {
    const caller = new AbortController();
    const entered = deferred(), gate = deferred();
    let completed = false, returned = false, settled = false;
    const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() { entered.resolve(); await gate.promise; completed = true; return { done: false, value: Buffer.from("12") }; },
      async return() { assert.equal(completed, true); returned = true; return { done: true, value: undefined }; },
    }; } };
    const execution = run([], "", {}, { stdin, signal: caller.signal });
    void execution.then(() => { settled = true; }, () => { settled = true; });
    try {
      await entered.promise;
      caller.abort(reason);
      await setImmediate();
      assert.deepEqual({ completed, returned, settled }, { completed: false, returned: false, settled: false });
      gate.resolve();
      await assert.rejects(execution, error => Object.is(error, reason));
      assert.equal(returned, true);
    } finally { gate.resolve(); await execution.catch(() => {}); }
  });
}

for (const destination of ["stdout", "stderr"] as const) for (const reason of [false, 0, "", null, "dispose"] as const) {
  test(`actual Shell held owned ${destination} drains before ${JSON.stringify(reason)}`, async () => {
    const entered = deferred(), gate = deferred();
    const caller = new AbortController();
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(factorCommands());
    let settled = false, completed = false, writes = 0;
    const sink = {
      async write() { assert.fail("unexpected opaque route"); },
      ownedOutput: { consumerClosed: new AbortController().signal, async write() {
        writes++; entered.resolve(); await gate.promise; completed = true; throw new Error("late write error");
      } },
    };
    const execution = shell.exec(destination === "stdout" ? "factor 12" : "factor invalid", { signal: caller.signal, [destination]: sink });
    void execution.then(() => { settled = true; }, () => { settled = true; });
    let disposal: Promise<void> | undefined;
    try {
      await entered.promise;
      if (reason === "dispose") disposal = shell.dispose(); else caller.abort(reason);
      await setImmediate();
      assert.deepEqual({ completed, settled, writes }, { completed: false, settled: false, writes: 1 });
      gate.resolve();
      await assert.rejects(execution, error => reason === "dispose" ? error instanceof Error : Object.is(error, reason));
      assert.equal(completed, true);
      if (disposal) await disposal;
    } finally { gate.resolve(); await execution.catch(() => {}); await shell.dispose(); }
  });
}
