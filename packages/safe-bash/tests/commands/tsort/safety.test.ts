import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { FsError, toByteSource, type ByteSource, type CommandContext, type FileSystem } from "../../../src/contracts/index.js";
import { createTsortCommand, createTsortCommands, tsortCommands, type TsortCommandsOptions, type TsortLimits } from "../../../src/commands/tsort/index.js";

async function run(args: string[] = [], input = "a b", options: TsortCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const stdout: number[] = [], stderr: number[] = [];
  const result = await createTsortCommand(options).execute({
    command: "tsort", args, cwd: "/", env: { LC_ALL: "C" }, fs: new MemoryFileSystem(),
    signal: new AbortController().signal, stdin: toByteSource(input),
    stdout: { async write(value) { stdout.push(...value); } }, stderr: { async write(value) { stderr.push(...value); } }, ...overrides,
  });
  return { ...result, stdout: Buffer.from(stdout).toString("latin1"), stderr: Buffer.from(stderr).toString("latin1") };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("factories expose one command and preserve explicit replacement", async () => {
  assert.deepEqual(createTsortCommands().map(command => command.name), ["tsort"]);
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(tsortCommands());
  try {
    await shell.exec(":");
    assert.throws(() => tsortCommands().setup({ commands: shell.commands, use() {}, registerFileSystem() {} }));
    shell.use(tsortCommands({ replace: true }));
    assert.equal((await shell.exec("tsort", { stdin: "b a" })).stdout, "b\na\n");
  } finally { await shell.dispose(); }
});

for (const limit of ["maxArguments", "maxArgumentBytes", "maxInputBytes", "maxTokenBytes", "maxTokens", "maxNodes", "maxEdges", "maxBufferedBytes", "maxOutputBytes", "maxDiagnosticBytes", "maxWork", "maxEmptyChunks"] as const satisfies readonly (keyof TsortLimits)[]) {
  test(`invalid ${limit} rejected at factory construction`, () => {
    for (const value of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => createTsortCommand({ limits: { [limit]: value } }), RangeError);
  });
}

for (const [input, limits, message] of [
  ["a b", { maxInputBytes: 2 }, "input bytes"],
  ["aa b", { maxTokenBytes: 1 }, "token bytes"],
  ["a\0ignored b", { maxTokenBytes: 3 }, "token bytes"],
  ["a a a a", { maxTokens: 3 }, "tokens"],
  ["a b", { maxNodes: 1 }, "nodes"],
  ["a b a b", { maxEdges: 1 }, "edges"],
  ["a b", { maxBufferedBytes: 3 }, "buffered bytes"],
  ["a b", { maxWork: 1 }, "work"],
] as const) test(`bounded ${message}: ${JSON.stringify(input)}`, async () => {
  const result = await run([], input, { limits });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes(`${message} limit exceeded`), result.stderr);
});

test("stdout cap preserves already written nodes, without emitting a partial next node", async () => {
  const result = await run([], "a b", { limits: { maxOutputBytes: 3 } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "a\n");
  assert.ok(result.stderr.includes("output bytes limit exceeded"));
});

test("self pairs do not spend edge budget", async () => {
  assert.equal((await run([], "a a a a b b", { limits: { maxEdges: 1 } })).stdout, "a\nb\n");
});

test("cycle diagnostics stop at the cumulative stderr bound", async () => {
  const stderr: Uint8Array[] = [];
  await assert.rejects(run([], "a b b a", { limits: { maxDiagnosticBytes: 33 } }, {
    stderr: { async write(value) { stderr.push(Uint8Array.from(value)); } },
  }), AggregateError);
  assert.equal(Buffer.concat(stderr).toString(), "tsort: -: input contains a loop:\n");
});

test("actual Shell stdout budget charges node bytes exactly once", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(tsortCommands());
  try {
    const result = await shell.exec("tsort", { stdin: "a b", limits: { maxOutputBytes: 4 } });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "a\nb\n");
  } finally { await shell.dispose(); }
});

test("virtual null input reaches EOF without reading stdin", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(tsortCommands());
  try {
    const result = await shell.exec("tsort /dev/null", { stdin: { [Symbol.asyncIterator]() { return {
      async next() { assert.fail("stdin read for explicit null input"); },
    }; } } });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout: "", stderr: "" });
  } finally { await shell.dispose(); }
});

test("provider character streams still enforce input bounds and return cleanup", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/device", Buffer.from(""));
  const stat = fs.stat.bind(fs);
  fs.stat = async (path, options) => ({ ...await stat(path, options), type: "character" });
  let returned = 0, reads = 0;
  fs.readStream = () => ({ [Symbol.asyncIterator]() { return {
    async next() { reads++; return { done: false, value: Buffer.from("a a ") }; },
    async return() { returned++; return { done: true, value: undefined }; },
  }; } });
  const result = await run(["device"], "", { limits: { maxInputBytes: 4 } }, { fs });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "tsort: input bytes limit exceeded\n");
  assert.deepEqual({ returned, reads }, { returned: 1, reads: 2 });
});

test("readFile fallback preserves bytes and imposes maxBytes before admission", async () => {
  const fs: FileSystem = new MemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("b a"));
  const readFile = fs.readFile.bind(fs);
  fs.capabilitiesFor = async () => ({ ...fs.capabilities, streamingRead: false });
  const maxima: (number | undefined)[] = [];
  fs.readFile = async (path, options) => { maxima.push(options?.maxBytes); return readFile(path, options); };
  assert.equal((await run(["input"], "", { limits: { maxInputBytes: 8 } }, { fs })).stdout, "b\na\n");
  assert.deepEqual(maxima, [8]);
});

test("fallback snapshot and copied chunk consume concurrent memory", async () => {
  const fs: FileSystem = new MemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("a".repeat(512)));
  fs.capabilitiesFor = async () => ({ ...fs.capabilities, streamingRead: false });
  const result = await run(["input"], "", { limits: { maxBufferedBytes: 1100, maxInputBytes: 512 } }, { fs });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes("buffered bytes limit exceeded"));
});

test("cooperative graph parsing cancellation keeps stdout empty", async () => {
  const caller = new AbortController();
  const input = "a a ".repeat(4096);
  const execution = run([], input, {}, { signal: caller.signal });
  const cancellation = setImmediate().then(() => { caller.abort(false); });
  await assert.rejects(execution, error => error === false);
  await cancellation;
});

test("cancellation scheduled at EOF interrupts in-memory ordering", async () => {
  const caller = new AbortController();
  let cancellation: Promise<void> | undefined;
  const input = Array.from({ length: 512 }, (_, index) => `${index} ${index}`).join(" ");
  let writes = 0;
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() {
    yield Buffer.from(input);
    cancellation = setImmediate().then(() => { caller.abort(0); });
  } };
  await assert.rejects(run([], "", {}, { stdin, signal: caller.signal, stdout: { async write() { writes++; } } }), error => error === 0);
  await cancellation;
  assert.equal(writes, 0);
});

test("cycle walk cancellation preserves caller reason after loop header", async () => {
  const caller = new AbortController();
  let cancellation: Promise<void> | undefined;
  const input = Array.from({ length: 256 }, (_, index) => `${index} ${(index + 1) % 256}`).join(" ");
  let diagnostics = 0;
  await assert.rejects(run([], input, {}, { signal: caller.signal, stderr: { async write() {
    diagnostics++;
    cancellation ??= setImmediate().then(() => { caller.abort(null); });
  } } }), error => error === null);
  await cancellation;
  assert.ok(diagnostics > 0);
});

test("empty source fragments are bounded and iterator is returned", async () => {
  let pulled = 0, returned = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { pulled++; return { done: false, value: new Uint8Array() }; },
    async return() { returned++; return { done: true, value: undefined }; },
  }; } };
  const result = await run([], "", { limits: { maxEmptyChunks: 2 } }, { stdin });
  assert.equal(result.exitCode, 1);
  assert.equal(pulled, 3);
  assert.equal(returned, 1);
});

test("input fragments are copied before producer reuse and finalization", async () => {
  const fragment = Buffer.from("b a");
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() {
    try { yield fragment; fragment.set(Buffer.from(" c ")); yield fragment; fragment.set(Buffer.from("c c")); yield fragment; }
    finally { fragment.fill(88); }
  } };
  const result = await run([], "", {}, { stdin });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes("odd number"));
  assert.deepEqual(fragment, Buffer.from("XXX"));
});

test("BOM filenames remain distinct from unprefixed filenames", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/\ufeffinput", Buffer.from("b a"));
  await fs.writeFile("/input", Buffer.from("x y"));
  assert.equal((await run(["\ufeffinput"], "", {}, { fs })).stdout, "b\na\n");
});

test("invalid raw UTF8 argv cannot hit the replacement filename", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/�", Buffer.from("wrong wrong"));
  const shell = new Shell({ fs }).use(tsortCommands());
  try {
    const result = await shell.exec("tsort $'\\xff'");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("valid UTF-8"));
  } finally { await shell.dispose(); }
});

test("malformed JavaScript argv and NUL argv are rejected", async () => {
  for (const value of ["\ud800", "\udfff", "\0"]) assert.equal((await run([value])).exitCode, 1);
});

test("argument memory accounts UTF8 byte length before filesystem admission", async () => {
  const fs = new MemoryFileSystem();
  let calls = 0;
  fs.stat = async () => { calls++; throw new FsError("ENOENT"); };
  const result = await run(["é"], "", { limits: { maxBufferedBytes: 40 } }, { fs });
  assert.equal(result.exitCode, 1);
  assert.equal(calls, 0);
  assert.ok(result.stderr.includes("buffered bytes limit exceeded"));
});

for (const limits of [{ maxArgumentBytes: 1 }, { maxArguments: 1 }]) test(`argument limit before input ${JSON.stringify(limits)}`, async () => {
  let acquired = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { acquired++; return toByteSource("")[Symbol.asyncIterator](); } };
  assert.equal((await run(["--", "-"], "", { limits }, { stdin })).exitCode, 1);
  assert.equal(acquired, 0);
});

test("stream I/O errors are explicit failures, not native stdio error suppression", async () => {
  let returned = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { throw new FsError("EIO"); },
    async return() { returned++; return { done: true, value: undefined }; },
  }; } };
  const result = await run([], "", {}, { stdin });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "tsort: -: Input/output error\n");
  assert.equal(returned, 1);
});

test("odd input and failing return preserve both errors", async () => {
  const cleanup = new Error("return failed");
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { return { done: false, value: Buffer.from("a a") }; },
    async return() { throw cleanup; },
  }; } };
  await assert.rejects(run([], "", { limits: { maxInputBytes: 2 } }, { stdin }), error => error instanceof AggregateError && error.errors[1] === cleanup);
});

for (const reason of [false, 0, "", null]) {
  test(`synchronous acquisition cancellation returns admitted iterator: ${JSON.stringify(reason)}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input", Buffer.from("a b"));
    const caller = new AbortController();
    let returned = 0, pulled = 0;
    fs.readStream = () => {
      caller.abort(reason);
      return { [Symbol.asyncIterator]() { return {
        async next() { pulled++; return { done: true, value: undefined }; },
        async return() { returned++; return { done: true, value: undefined }; },
      }; } };
    };
    await assert.rejects(run(["input"], "", {}, { fs, signal: caller.signal }), error => Object.is(error, reason));
    assert.deepEqual({ returned, pulled }, { returned: 1, pulled: 0 });
  });

  test(`held next drains before cleanup and preserves ${JSON.stringify(reason)}`, async () => {
    const entered = deferred(), gate = deferred();
    const caller = new AbortController();
    let returned = false, completed = false, settled = false;
    const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() { entered.resolve(); await gate.promise; completed = true; return { done: false, value: Buffer.from("a b") }; },
      async return() { assert.equal(completed, true); returned = true; return { done: true, value: undefined }; },
    }; } };
    const execution = run([], "", {}, { stdin, signal: caller.signal });
    void execution.then(() => { settled = true; }, () => { settled = true; });
    try {
      await entered.promise;
      caller.abort(reason);
      await setImmediate();
      assert.deepEqual({ returned, completed, settled }, { returned: false, completed: false, settled: false });
      gate.resolve();
      await assert.rejects(execution, error => Object.is(error, reason));
      assert.equal(returned, true);
    } finally { gate.resolve(); await execution.catch(() => {}); }
  });

  test(`actual Shell owned stdout drains before caller ${JSON.stringify(reason)}`, async () => {
    const entered = deferred(), gate = deferred();
    const caller = new AbortController();
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(tsortCommands());
    let settled = false, writes = 0;
    const execution = shell.exec("tsort", { stdin: "a b", signal: caller.signal, stdout: {
      async write() { assert.fail("opaque output route"); },
      ownedOutput: { consumerClosed: new AbortController().signal, async write() { writes++; entered.resolve(); await gate.promise; throw new Error("late write"); } },
    } });
    void execution.then(() => { settled = true; }, () => { settled = true; });
    try {
      await entered.promise;
      caller.abort(reason);
      await setImmediate();
      assert.equal(settled, false);
      gate.resolve();
      await assert.rejects(execution, error => Object.is(error, reason));
      assert.equal(writes, 1);
      assert.equal((await shell.exec(":" )).exitCode, 0);
    } finally { gate.resolve(); await execution.catch(() => {}); await shell.dispose(); }
  });
}
