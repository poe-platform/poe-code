import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createMemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import type { CommandContext, InvocationCleanup } from "safe-bash-contracts/command";
import { FsError } from "safe-bash-contracts/errors";
import { toByteSource, type ByteSource } from "safe-bash-contracts/io";
import { createMdqCommand, mdq, parseMdqArguments, type MdqLimits, type MdqOptions } from "./index.js";
import { admitLimits, MdqBudget } from "./budget.js";
import { inline, node } from "./document.js";
import { render } from "./render.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(args: readonly string[] = [], input: string | ByteSource = "# Title\n\nHello.\n") {
  const output: Uint8Array[] = [], errors: Uint8Array[] = [], cleanups: InvocationCleanup[] = [];
  const caller = new AbortController();
  const context: CommandContext = {
    command: "mdq", args, cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: caller.signal,
    stdin: typeof input === "string" ? toByteSource(encoder.encode(input)) : input,
    stdout: { async write(bytes) { output.push(Uint8Array.from(bytes)); } },
    stderr: { async write(bytes) { errors.push(Uint8Array.from(bytes)); } },
    registerCleanup(cleanup) { cleanups.push(cleanup); }
  };
  return {
    context, caller, cleanups, output, errors,
    text: () => decoder.decode(Buffer.concat(output)),
    error: () => decoder.decode(Buffer.concat(errors))
  };
}

test("mdq owns decoded data across byte-by-byte UTF-8 producer reuse and finalization", async () => {
  const document = "# Title\n\nHéllo 😊.\n", bytes = encoder.encode(document), reused = Buffer.alloc(1);
  let finalized = false;
  const source = { async *[Symbol.asyncIterator]() {
    try {
      for (const byte of bytes) { reused[0] = byte; yield reused; reused.fill(0xff); }
    } finally { reused.fill(0); finalized = true; }
  } };
  const f = fixture([], source), result = await mdq(f.context);
  assert.equal(result.exitCode, 0, f.error());
  assert.equal(result.accounting.inputBytes, bytes.length);
  assert.equal(f.text(), document);
  assert.equal(finalized, true);
});

for (const bytes of [Uint8Array.of(0xff), Uint8Array.of(0xe2, 0x82)]) {
  test(`mdq refuses invalid UTF-8 input ${Array.from(bytes).join(",")}`, async () => {
    const f = fixture([], toByteSource(bytes)), result = await mdq(f.context);
    assert.equal(result.exitCode, 1);
    assert.equal(f.text(), "");
    assert.equal(f.error(), "invalid data while reading stdin\n");
  });
}

test("mdq refuses an oversized input chunk before another pull and awaits iterator return", async () => {
  const entered = deferred(), release = deferred();
  let pulls = 0, returns = 0, settled = false;
  const f = fixture([], { [Symbol.asyncIterator]() { return {
    async next() { pulls++; return { done: false, value: encoder.encode("too large") }; },
    async return() { returns++; entered.resolve(); await release.promise; return { done: true as const, value: undefined }; }
  }; } });
  const execution = mdq(f.context, { limits: { inputBytes: 3 } });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered.promise; await setImmediate();
    assert.equal(settled, false); assert.equal(pulls, 1); assert.equal(returns, 1);
    release.resolve(); assert.equal((await execution).exitCode, 1);
    assert.equal(f.error(), "mdq: inputBytes limit exceeded\n"); assert.equal(f.text(), "");
  } finally { release.resolve(); await execution.catch(() => {}); }
});

test("mdq applies the host input budget cumulatively across files", async () => {
  const f = fixture(["", "one", "two"]), observed: number[] = [], failure = new Error("host input quota");
  await f.context.fs.writeFile("/one", encoder.encode("abc"));
  await f.context.fs.writeFile("/two", encoder.encode("defg"));
  await assert.rejects(mdq({ ...f.context, inputBudget: {
    maxBytes: 6, check(total) { observed.push(total); if (total > 6) throw failure; }
  } }), error => error === failure);
  assert.deepEqual(observed, [3, 7]); assert.equal(f.text(), "");
});

const boundedCases: { limits: MdqLimits; input: string; args?: string[]; resource: string }[] = [
  { limits: { inputBytes: 0 }, input: "x", resource: "inputBytes" },
  { limits: { retainedBytes: 0 }, input: "x", resource: "retainedBytes" },
  { limits: { nodes: 0 }, input: "x", resource: "nodes" },
  { limits: { references: 0 }, input: "[a]: /url\n\n[a]\n", resource: "references" },
  { limits: { tableCells: 0 }, input: "| a |\n|---|\n| b |\n", resource: "tableCells" },
  { limits: { text: 0 }, input: "x", resource: "text" },
  { limits: { entities: 0 }, input: "&#65;", resource: "entities" },
  { limits: { entityBytes: 0 }, input: "&#65;", resource: "entityBytes" },
  { limits: { depth: 0 }, input: "> nested\n", resource: "depth" },
  { limits: { work: 0 }, input: "x", resource: "work" },
  { limits: { arguments: 0 }, input: "x", args: ["#"], resource: "arguments" },
  { limits: { argumentBytes: 0 }, input: "x", args: ["#"], resource: "argumentBytes" },
  { limits: { files: 0 }, input: "x", args: ["", "missing"], resource: "files" }
];
for (const { limits, input, args, resource } of boundedCases) {
  test(`mdq enforces the ${resource} limit`, async () => {
    const f = fixture(args, input), result = await mdq(f.context, { limits });
    assert.equal(result.exitCode, 1);
    assert.equal(f.text(), "");
    assert.equal(f.error(), `mdq: ${resource} limit exceeded\n`);
  });
}

test("mdq bounds empty chunks and closes the producer", async () => {
  let pulls = 0, finalized = false;
  const f = fixture([], { async *[Symbol.asyncIterator]() {
    try { for (let i = 0; i < 3; i++) { pulls++; yield new Uint8Array(); } }
    finally { finalized = true; }
  } });
  assert.equal((await mdq(f.context, { limits: { emptyChunks: 1 } })).exitCode, 1);
  assert.equal(pulls, 2); assert.equal(finalized, true);
  assert.equal(f.error(), "mdq: emptyChunks limit exceeded\n");
});

test("mdq output limits reject before any stdout write, including help and version", async () => {
  for (const args of [[], ["--help"], ["--version"]]) {
    const f = fixture(args), result = await mdq(f.context, { limits: { outputBytes: 1 } });
    assert.equal(result.exitCode, 1);
    assert.equal(f.text(), ""); assert.equal(f.error(), "mdq: outputBytes limit exceeded\n");
  }
  const quiet = fixture(["--quiet"]);
  assert.equal((await mdq(quiet.context, { limits: { outputBytes: 0 } })).exitCode, 0);
  assert.equal(quiet.text(), "");
});

test("mdq emits complete Unicode diagnostics with valid UTF-8", async () => {
  const f = fixture(["P: \"" + "😀".repeat(5000)]);
  assert.equal((await mdq(f.context)).exitCode, 1);
  const bytes = Buffer.concat(f.errors);
  assert.ok(bytes.length > 16_384, `diagnostic wrote ${bytes.length} bytes`);
  assert.ok(decoder.decode(bytes).endsWith("\n"));
  assert.doesNotThrow(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes));
});

test("mdq supplies the remaining host quota to byte-only VFS reads", async () => {
  const f = fixture(["", "one", "two"]), maxima: number[] = [];
  Object.defineProperty(f.context.fs, "readStream", { value: undefined });
  Object.defineProperty(f.context.fs, "readFile", { value: async (_path: string, options?: { maxBytes?: number }) => {
    maxima.push(options!.maxBytes!); return encoder.encode("abc");
  } });
  const result = await mdq({ ...f.context, inputBudget: { maxBytes: 8, check(total) { assert.ok(total <= 8); } } });
  assert.equal(result.exitCode, 0, f.error()); assert.deepEqual(maxima, [8, 5]);
});

test("mdq waits for an admitted byte-only VFS read after caller cancellation", async () => {
  const f = fixture(["", "held"]), entered = deferred(), release = deferred<Uint8Array>();
  let settled = false;
  Object.defineProperty(f.context.fs, "readStream", { value: undefined });
  Object.defineProperty(f.context.fs, "readFile", { value: async (_path: string, options?: { signal?: AbortSignal }) => {
    assert.equal(options?.signal?.aborted, false); entered.resolve(); return release.promise;
  } });
  const execution = mdq(f.context), reason = new Error("read cancelled");
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered.promise; f.caller.abort(reason); await setImmediate(); assert.equal(settled, false);
    release.resolve(encoder.encode("late")); await assert.rejects(execution, error => error === reason);
    assert.equal(f.output.length, 0); assert.equal(f.errors.length, 0);
  } finally { release.resolve(new Uint8Array()); await execution.catch(() => {}); }
});

test("mdq snapshots SDK file operands before yielding", async () => {
  const f = fixture(), files = ["before"];
  await f.context.fs.writeFile("/before", encoder.encode("Original\n"));
  const execution = mdq(f.context, { files }); files[0] = "after";
  assert.equal((await execution).exitCode, 0, f.error()); assert.equal(f.text(), "Original\n");
});

test("mdq preserves Unicode characters crossing its output chunk boundaries", async () => {
  const source = "<div>" + "x".repeat(4090) + "😀" + "é".repeat(5000) + "</div>\n", f = fixture([], source);
  const result = await mdq(f.context);
  assert.equal(result.exitCode, 0, f.error()); assert.equal(f.text(), source);
  for (const bytes of f.output) {
    assert.ok(bytes.length <= 16_384);
    assert.doesNotThrow(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }
});

test("mdq validates typed argument counts before reading file operands", async () => {
  const f = fixture(), files = Array<string>(4);
  let operandsRead = 0;
  for (let i = 0; i < files.length; i++) Object.defineProperty(files, i, { get() { operandsRead++; return "file"; } });
  const result = await mdq(f.context, { files, limits: { arguments: 2 } });
  assert.equal(result.exitCode, 1);
  assert.equal(f.error(), "mdq: arguments limit exceeded\n");
  assert.equal(operandsRead, 0, "over-limit typed argv must be refused before materialization");
});

test("mdq rejects unknown limit keys inherited by ordinary objects", () => {
  for (const key of ["toString", "constructor"]) assert.throws(() => createMdqCommand({ limits: { [key]: 0 } }), RangeError);
});

test("mdq charges regex execution and document work to one invocation quota", () => {
  const f = fixture(), budget = new MdqBudget(f.context, admitLimits({ work: 5 }));
  budget.regex.step(3); budget.charge("work", 2);
  assert.equal(budget.counts.work, 5);
  assert.throws(() => budget.regex.step(), /work limit exceeded/);
});

test("mdq registers cleanup synchronously before acquiring output or input", async () => {
  const f = fixture(); let acquired = 0;
  const context: CommandContext = {
    ...f.context,
    registerCleanup(cleanup) { assert.equal(this, context); if (!f.cleanups.length) assert.equal(acquired, 0); f.cleanups.push(cleanup); },
    get stdout() { assert.ok(f.cleanups.length > 0); acquired++; return f.context.stdout; },
    stdin: { async *[Symbol.asyncIterator]() { assert.ok(f.cleanups.length > 0); yield encoder.encode("text"); } }
  };
  const execution = mdq(context);
  assert.equal(f.cleanups.length, 1);
  assert.equal((await execution).exitCode, 0);
  await Promise.all(f.cleanups.map(cleanup => cleanup()));
});

test("mdq registered cleanup blocks acquisition and shares completion before its task starts", async () => {
  const f = fixture(); let closing: void | Promise<void>, sameClose: void | Promise<void>, pulls = 0;
  const execution = mdq({ ...f.context,
    stdin: { async *[Symbol.asyncIterator]() { pulls++; yield encoder.encode("unused"); } },
    registerCleanup(cleanup) { closing = cleanup(); sameClose = cleanup(); }
  });
  await assert.rejects(execution, { message: "mdq invocation closed" });
  assert.equal(closing!, sameClose!); await closing!;
  assert.equal(pulls, 0); assert.equal(f.output.length, 0); assert.equal(f.errors.length, 0);
});

test("mdq preserves input failure and falsey iterator cleanup failure", async () => {
  const f = fixture([], { [Symbol.asyncIterator]() { return {
    async next() { return { done: false, value: encoder.encode("too large") }; },
    async return() { throw false; }
  }; } });
  await assert.rejects(mdq(f.context, { limits: { inputBytes: 0 } }), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    assert.equal(error.errors[0].message, "mdq: inputBytes limit exceeded\n");
    assert.equal(error.errors[1], false); return true;
  });
});

for (const reason of [false, null, new Error("caller cancelled")]) {
  test(`mdq preserves already-aborted caller reason ${String(reason)}`, async () => {
    let pulls = 0;
    const f = fixture([], { async *[Symbol.asyncIterator]() { pulls++; yield encoder.encode("text"); } });
    f.caller.abort(reason);
    await assert.rejects(mdq(f.context), error => Object.is(error, reason));
    assert.equal(pulls, 0); assert.equal(f.output.length, 0); assert.equal(f.errors.length, 0);
  });
}

test("mdq refuses preclosed stdout before pulling document input", async () => {
  const consumer = new AbortController(), reason = new Error("downstream already closed");
  consumer.abort(reason); let pulls = 0;
  const f = fixture([], { async *[Symbol.asyncIterator]() { pulls++; yield encoder.encode("text"); } });
  await assert.rejects(mdq({ ...f.context, stdout: {
    async write() { assert.fail("opaque output route"); },
    ownedOutput: { consumerClosed: consumer.signal, async write() { assert.fail("closed output route"); } }
  } }), error => error === reason);
  assert.equal(pulls, 0); assert.equal(f.errors.length, 0); assert.equal(f.caller.signal.aborted, false);
});

test("quiet mdq keeps reading when the unused stdout consumer closes", async () => {
  const consumer = new AbortController();
  const f = fixture(["--quiet"], { async *[Symbol.asyncIterator]() {
    yield encoder.encode("# Title\n"); consumer.abort(new Error("unused stdout closed")); yield encoder.encode("\nbody\n");
  } });
  const result = await mdq({ ...f.context, stdout: {
    async write() { assert.fail("quiet stdout route"); },
    ownedOutput: { consumerClosed: consumer.signal, async write() { assert.fail("quiet owned stdout route"); } }
  } });
  assert.equal(result.exitCode, 0, f.error());
  assert.equal(f.caller.signal.aborted, false); assert.equal(f.errors.length, 0);
});

for (const origin of ["caller", "consumer"] as const) {
  test(`mdq drains a cooperative input iterator return after ${origin} cancellation`, async () => {
    const consumer = new AbortController(), entered = deferred(), returning = deferred(), release = deferred();
    const next = deferred<IteratorResult<Uint8Array>>(), reason = new Error(`${origin} closed`);
    let returns = 0, settled = false;
    const f = fixture([], { [Symbol.asyncIterator]() { return {
      next() { entered.resolve(); return next.promise; },
      async return() { returns++; returning.resolve(); await release.promise; return { done: true as const, value: undefined }; }
    }; } });
    const execution = mdq({ ...f.context, stdout: {
      async write() { assert.fail("output should not start"); },
      ownedOutput: { consumerClosed: consumer.signal, async write() { assert.fail("output should not start"); } }
    } });
    void execution.then(() => { settled = true; }, () => { settled = true; });
    try {
      await entered.promise;
      (origin === "caller" ? f.caller : consumer).abort(reason);
      next.resolve({ done: true, value: undefined });
      await returning.promise; await setImmediate();
      assert.equal(returns, 1); assert.equal(settled, false, "execution must await admitted iterator cleanup");
      release.resolve(); await assert.rejects(execution, error => error === reason);
    } finally { release.resolve(); next.resolve({ done: true, value: undefined }); await execution.catch(() => {}); }
  });
}

test("mdq drains owned writes under cancellation and preserves destination backpressure", async () => {
  const f = fixture([], "```\n" + "x".repeat(20_000) + "\n```\n"), entered = deferred(), release = deferred();
  const reason = new Error("stop output"); let writes = 0, settled = false;
  const execution = mdq({ ...f.context, stdout: {
    async write() { assert.fail("opaque output route"); },
    ownedOutput: { consumerClosed: new AbortController().signal, async write() { writes++; entered.resolve(); await release.promise; } }
  } });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered.promise; await setImmediate(); assert.equal(writes, 1);
    f.caller.abort(reason); await setImmediate(); assert.equal(settled, false);
    release.resolve(); await assert.rejects(execution, error => error === reason); assert.equal(writes, 1);
  } finally { release.resolve(); await execution.catch(() => {}); }
});

test("closed stdout does not cancel an admitted independent diagnostic write", async () => {
  const f = fixture(["--invalid"]), consumer = new AbortController(), entered = deferred(), release = deferred();
  let diagnostics = 0, settled = false;
  const execution = mdq({ ...f.context, stdout: {
    async write() { assert.fail("stdout route"); }, ownedOutput: { consumerClosed: consumer.signal, async write() { assert.fail("stdout route"); } }
  }, stderr: {
    async write() { assert.fail("opaque diagnostic route"); },
    ownedOutput: { consumerClosed: new AbortController().signal, async write() { diagnostics++; entered.resolve(); await release.promise; } }
  } });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered.promise; consumer.abort(new Error("stdout closed")); await setImmediate();
    assert.equal(settled, false); assert.equal(diagnostics, 1);
    release.resolve(); assert.equal((await execution).exitCode, 2); assert.equal(f.caller.signal.aborted, false);
  } finally { release.resolve(); await execution.catch(() => {}); }
});

for (const output of ["markdown", "plain", "json"] as const) {
  test(`mdq ${output} rendering observes cancellation scheduled during traversal`, async () => {
    const f = fixture(), roots = Array.from({ length: 600 }, () => node("paragraph", { inline: [inline("text", "body")] }));
    const budget = new MdqBudget(f.context, admitLimits()), reason = new Error("render cancelled");
    const execution = render({ roots, footnotes: new Map() }, roots, parseMdqArguments(["--output", output]), budget);
    const cancelled = setImmediate().then(() => f.caller.abort(reason));
    await assert.rejects(execution, error => error === reason); await cancelled;
  });
}

test("mdq rendering applies retention and work quotas independently of input parsing", async () => {
  const f = fixture(), paragraph = node("paragraph", { inline: [inline("text", "text")] });
  for (const limits of [{ retainedBytes: 0 }, { work: 0 }]) {
    const budget = new MdqBudget(f.context, admitLimits(limits)), resource = Object.keys(limits)[0];
    await assert.rejects(render({ roots: [paragraph], footnotes: new Map() }, [paragraph], parseMdqArguments([]), budget),
      error => error instanceof Error && error.message === `mdq: ${resource} limit exceeded\n`);
  }
});

const parityCases: { argv: string[]; options: MdqOptions }[] = [
  { argv: ["-o", "json", "# Title"], options: { selectors: "# Title", output: "json" } },
  { argv: ["-o", "plain", "--br"], options: { output: "plain", breaks: true } },
  { argv: ["-l", "inline", "--no-br"], options: { linkFormat: "inline", breaks: false } },
  { argv: ["--link-pos", "doc", "--footnote-pos", "section", "--renumber-footnotes", "false"], options: { linkPos: "doc", footnotePos: "section", renumberFootnotes: false } },
  { argv: ["--wrap-width", "12"], options: { wrapWidth: 12 } },
  { argv: ["--quiet", "--allow-unknown-markdown"], options: { quiet: true, allowUnknownMarkdown: true } }
];
for (const { argv, options } of parityCases) {
  test(`mdq CLI and typed SDK option parity: ${argv.join(" ")}`, async () => {
    const document = "# Title\n\nSeveral words [a link](https://example.test). Note[^n].\n\n[^n]: Footnote body.\n";
    const cli = fixture(argv, document), sdk = fixture([], document);
    const cliResult = await createMdqCommand().execute(cli.context), sdkResult = await mdq(sdk.context, options);
    assert.equal(cliResult.exitCode, 0, cli.error()); assert.equal(sdkResult.exitCode, cliResult.exitCode);
    assert.equal(sdk.text(), cli.text()); assert.equal(sdk.error(), cli.error());
  });
}


test("mdq limits default to disabled and accept arbitrary safe nonnegative values", () => {
  for (const key of Object.keys(admitLimits())) {
    for (const value of [Infinity, 0, 200, Number.MAX_SAFE_INTEGER])
      assert.equal(admitLimits({ [key]: value })[key as keyof MdqLimits], value);
    assert.equal(admitLimits()[key as keyof MdqLimits], Infinity);
    for (const value of [-1, -Infinity, NaN, 0.5, Number.MAX_SAFE_INTEGER + 1])
      assert.throws(() => admitLimits({ [key]: value }), RangeError);
  }
});

test("mdq defaults admit deep documents, many files and arguments, and empty chunks", async () => {
  const deep = fixture([], "> ".repeat(130) + "hello\n");
  assert.equal((await mdq(deep.context)).exitCode, 0, deep.error());
  const many = fixture(["", ...Array<string>(1030).fill("-")], "hello\n");
  assert.equal((await mdq(many.context)).exitCode, 0, many.error());
  const empty = fixture([], { async *[Symbol.asyncIterator]() {
    for (let i = 0; i < 1030; i++) yield new Uint8Array();
    yield encoder.encode("hello\n");
  } });
  assert.equal((await mdq(empty.context, { limits: { work: Infinity, retainedBytes: Infinity } })).exitCode, 0, empty.error());
});

for (const resource of ["inputBytes", "retainedBytes"] as const) {
  test(`mdq translates byte-only VFS EFBIG into ${resource} exhaustion`, async () => {
    const f = fixture(["", "test.md"]);
    await f.context.fs.writeFile("/test.md", encoder.encode("hello world\n"));
    Object.defineProperty(f.context.fs, "readStream", { value: undefined });
    // Leave only a few bytes after admitting the file arguments.
    const limit = resource === "inputBytes" ? 3 : 33;
    assert.equal((await mdq(f.context, { limits: { [resource]: limit } })).exitCode, 1);
    assert.equal(f.error(), `mdq: ${resource} limit exceeded\n`);
  });
}

test("mdq propagates byte-only VFS host input budget rejection", async () => {
  const f = fixture(["", "one", "two"]), totals: number[] = [];
  await f.context.fs.writeFile("/one", encoder.encode("abc"));
  await f.context.fs.writeFile("/two", encoder.encode("defg"));
  Object.defineProperty(f.context.fs, "readStream", { value: undefined });
  const failure = new TypeError("host quota exhausted");
  await assert.rejects(mdq({ ...f.context, inputBudget: { maxBytes: 6, check(total) {
    totals.push(total); if (total > 6) throw failure;
  } } }), error => error === failure);
  assert.deepEqual(totals, [3, 7]);
  assert.equal(f.error(), "");
});


test("mdq preserves the full filename in diagnostics beyond 16 KiB", async () => {
  const path = "/" + "😀".repeat(5000), f = fixture(["", path]);
  Object.defineProperty(f.context.fs, "readStream", { value: undefined });
  Object.defineProperty(f.context.fs, "readFile", { value: async () => { throw new FsError("ENOENT"); } });
  assert.equal((await mdq(f.context)).exitCode, 1);
  assert.equal(f.error(), `entity not found while reading file ${JSON.stringify(path)}\n`);
});

test("mdq omits disabled byte-only VFS read caps", async () => {
  const f = fixture(["", "test.md"]);
  Object.defineProperty(f.context.fs, "readStream", { value: undefined });
  Object.defineProperty(f.context.fs, "readFile", { value: async (_path: string, options?: { maxBytes?: number }) => {
    assert.equal(options?.maxBytes, undefined);
    return encoder.encode("hello\n");
  } });
  assert.equal((await mdq(f.context)).exitCode, 0, f.error());
});
