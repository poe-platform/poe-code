import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createCommandArguments, FsError, toByteSource, type ByteSource, type CommandContext, type FileSystem, type InvocationCleanup } from "../../src/contracts/index.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
import { fmtCommand } from "../../src/commands/fmt.js";
import { fixture } from "./helpers.js";

async function format(args: readonly string[], input: string | Uint8Array | ByteSource = "", overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "fmt", args, cwd: "/work", env: { LC_ALL: "C" }, fs: await fixture(),
    stdin: typeof input === "string" || input instanceof Uint8Array ? toByteSource(input) : input,
    stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
    signal: new AbortController().signal, ...overrides,
  };
  const result = await fmtCommand().execute(context);
  return { exitCode: result.exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
}

for (const [name, args, input, expected] of [
  ["optimized non-greedy lines", ["-w20"], "one two three four five six seven eight nine ten\n", "one two three four\nfive six seven\neight nine ten\n"],
  ["strict maximum width", ["-w12"], "12345 123456\n", "12345\n123456\n"],
  ["uniform sentence spacing", ["-w20", "-u"], "Hello.   There,    friend!\nNext sentence here.\n", "Hello.  There,\nfriend!  Next\nsentence here.\n"],
  ["crown margins", ["-w18", "-c"], "  alpha beta gamma\n    delta epsilon zeta eta theta\n", "  alpha beta\n    gamma delta\n    epsilon zeta\n    eta theta\n"],
  ["tagged default secondary margin", ["-w18", "-t"], "alpha beta gamma delta epsilon\n", "alpha beta gamma\n   delta epsilon\n"],
  ["prefix paragraphs and unmatched lines", ["-w20", "-p", "# "], "# alpha beta gamma delta\n# epsilon zeta eta\nother line untouched\n", "# alpha beta gamma\n# delta epsilon\n# zeta eta\nother line untouched\n"],
  ["tabs", ["-w20"], "a\tb c d e f g h i j k l m n\n", "a\tb c d e f\ng h i j k l m n\n"],
  ["control characters inside words", ["-w20"], "a\vb\fc\rd\0e\n", "a\vb\fc\rd\0e\n"],
  ["split only", ["-w15", "-s"], "one two\nthree four five six\n", "one two\nthree four\nfive six\n"],
  ["paragraph indentation", ["-w20"], "alpha beta\n\n  gamma delta\n    epsilon zeta\n", "alpha beta\n\n  gamma delta\n    epsilon zeta\n"],
  ["zero width", ["-w0"], "one two", "one\ntwo\n"],
] as const) test(`fmt ${name}`, async () => {
  const result = await format(args, input);
  assert.deepEqual(result, { exitCode: 0, stdout: Buffer.from(expected), stderr: Buffer.alloc(0) });
});

test("fmt defaults to 75 columns and supports equivalent option forms", async () => {
  const input = "one two three four five six seven eight nine ten ".repeat(4);
  const expected = await format(["-w75"], input);
  for (const args of [[], ["-75"], ["--width=75"], ["--wid", "75"], ["-w", "+75"], ["-w", " 075"], ["-w1", "-w75"]]) {
    assert.deepEqual(await format(args, input), expected);
  }
});

test("fmt reads only supplied VFS files, handles stdin once, and preserves file paragraph boundaries", async () => {
  const fs = await fixture({ first: "one two", second: "three four" });
  assert.deepEqual(await format(["first", "-", "second", "-"], "stdin text", { fs }), {
    exitCode: 0, stdout: Buffer.from("one two\nstdin text\nthree four\n"), stderr: Buffer.alloc(0),
  });
});

test("fmt preserves non-UTF8 bytes", async () => {
  const bytes = Uint8Array.of(0xff, 0x80, 32, 0xc3, 0xa9, 10);
  assert.deepEqual((await format([], bytes)).stdout, Buffer.from(bytes));
});

test("fmt matches prefixes by immutable raw argument bytes rather than decoded text", async () => {
  const argumentValues = createCommandArguments([shellValueFromBytes(Uint8Array.of(45, 117, 112, 0xff))]);
  const input = Uint8Array.of(0xff, 32, 97, 32, 32, 98, 10, 0xfe, 32, 99, 32, 32, 100, 10);
  const result = await format(argumentValues.args, input, { argumentValues });
  assert.deepEqual(result, { exitCode: 0, stdout: Buffer.from([0xff, 32, 97, 32, 98, 10, 0xfe, 32, 99, 32, 32, 100, 10]), stderr: Buffer.alloc(0) });
});

test("fmt reads metadata-free VFS streams", async () => {
  const fs: FileSystem = await fixture({ file: "one two" });
  fs.stat = async () => { throw new Error("metadata not permitted"); };
  assert.equal((await format(["file"], "", { fs })).stdout.toString(), "one two\n");
});

for (const [args, message] of [
  [["-w2501"], "invalid width: '2501': Numerical result out of range\n"],
  [["-w-1"], "invalid width: '-1'\n"],
  [["-g76"], "invalid width: '76': Numerical result out of range\n"],
  [["--width="], "invalid width: ''\n"],
  [["-w"], "option requires an argument -- 'w'\nTry 'fmt --help' for more information.\n"],
  [["-s", "-20"], "invalid option -- 2; -WIDTH is recognized only when it is the first\noption; use -w N instead\nTry 'fmt --help' for more information.\n"],
  [["--foo"], "unrecognized option '--foo'\nTry 'fmt --help' for more information.\n"],
] as const) test(`fmt option diagnostic ${args.join(" ")}`, async () => {
  assert.deepEqual(await format(args), { exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(`fmt: ${message}`) });
});

test("fmt matches immutable GNU coreutils 8.30 stdout, stderr and status snapshots without normalization", async () => {
  const snapshot = JSON.parse(readFileSync(new URL("./fmt-native.snapshot.json", import.meta.url), "utf8")) as {
    cases: { args: string[]; stdin: string; files: Record<string, string>; env: Record<string, string>; expected: { exitCode: number; signal: null; stdout: string; stderr: string } }[];
  };
  for (const [index, entry] of snapshot.cases.entries()) {
    const fs = await fixture(Object.fromEntries(Object.entries(entry.files).map(([name, bytes]) => [name, Buffer.from(bytes, "base64")])));
    const actual = await format(entry.args, Buffer.from(entry.stdin, "base64"), { fs, env: { LC_ALL: "C", ...entry.env } });
    assert.deepEqual(actual, { exitCode: entry.expected.exitCode, stdout: Buffer.from(entry.expected.stdout, "base64"), stderr: Buffer.from(entry.expected.stderr, "base64") }, `native case ${index}: ${JSON.stringify(entry.args)}`);
  }
});

test("fmt owns producer bytes across buffer reuse and retirement", async () => {
  const storage = new Uint8Array(3);
  const input: ByteSource = { async *[Symbol.asyncIterator]() {
    try {
      for (const text of ["one", " tw", "o t", "hre", "e\n\n"]) { storage.set(new TextEncoder().encode(text)); yield storage; }
    } finally { storage.fill(0xff); }
  } };
  assert.equal((await format([], input)).stdout.toString(), "one two three\n\n");
});

test("fmt admits input bytes before copying oversized producer chunks and closes ownership once", async () => {
  let retired = 0;
  let cleanup: InvocationCleanup | undefined;
  const result = await format([], { [Symbol.asyncIterator]() { return {
    async next() { return { done: false, value: new Uint8Array(32 * 1024 * 1024 + 1) }; },
    async return() { retired++; return { done: true, value: undefined }; },
  }; } }, { registerCleanup(handler) { cleanup = handler; } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr.toString(), "fmt: byte command input limit exceeded\n");
  await cleanup!();
  assert.equal(retired, 1);
});

test("fmt bounds unproductive empty input without limiting productive tiny chunks", async () => {
  let retired = 0;
  const empty: ByteSource = { async *[Symbol.asyncIterator]() { try { while (true) yield new Uint8Array(); } finally { retired++; } } };
  const result = await format([], empty);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr.toString(), "fmt: empty input chunk limit exceeded\n");
  assert.equal(retired, 1);
  const productive: ByteSource = { async *[Symbol.asyncIterator]() { for (let index = 0; index < 4097; index++) yield Uint8Array.of(97); } };
  assert.deepEqual((await format([], productive)).stdout, Buffer.from("a".repeat(4097) + "\n"));
});

for (const reason of [false, 0, "", null, undefined]) test(`fmt preserves falsey read failure ${String(reason)}`, async () => {
  const errors: unknown[] = [];
  let closed = 0;
  const result = await format([], { [Symbol.asyncIterator]() { return {
    async next(): Promise<IteratorResult<Uint8Array>> { throw reason; },
    async return() { closed++; return { done: true, value: undefined }; },
  }; } }, { onInternalError(error) { errors.push(error); } });
  assert.deepEqual(errors, [reason]);
  assert.equal(result.exitCode, 1);
  assert.equal(closed, 1);
});

test("fmt retains the original read failure when owned cleanup also fails", async () => {
  const errors: unknown[] = [];
  const original = false;
  const result = await format([], { [Symbol.asyncIterator]() { return {
    async next(): Promise<IteratorResult<Uint8Array>> { throw original; },
    async return(): Promise<IteratorResult<Uint8Array>> { throw new Error("secondary retirement failure"); },
  }; } }, { onInternalError(error) { errors.push(error); } });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(errors, [original]);
});

test("fmt cancellation waits for cooperative registered cleanup and preserves its falsey reason", async () => {
  const controller = new AbortController();
  let cleanup: InvocationCleanup | undefined;
  let started!: () => void;
  const acquired = new Promise<void>(resolve => { started = resolve; });
  let finishRetirement!: () => void;
  const retirement = new Promise<void>(resolve => { finishRetirement = resolve; });
  let closed = 0;
  let settled = false;
  const pending = format([], { [Symbol.asyncIterator]() { return {
    next() { started(); return new Promise<IteratorResult<Uint8Array>>((_resolve, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true })); },
    async return() { closed++; await retirement; return { done: true, value: undefined }; },
  }; } }, { signal: controller.signal, registerCleanup(handler) { cleanup = handler; } });
  const observed = pending.then(() => { settled = true; }, error => { settled = true; assert.equal(error, false); });
  await acquired;
  controller.abort(false);
  const closing = cleanup!();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(closed, 1);
  finishRetirement();
  await closing;
  await observed;
  assert.equal(settled, true);
});

test("fmt yields during paragraph optimization so cancellation can interrupt CPU work", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel formatting");
  const pending = format(["-w2500"], "a ".repeat(20000), { signal: controller.signal });
  setImmediate(() => controller.abort(reason));
  await assert.rejects(pending, error => error === reason);
});

test("fmt cleanup closes admission without awaiting opaque capabilities metadata", async () => {
  for (const cancelParent of [false, true]) {
    const fs: FileSystem = await fixture();
    const controller = new AbortController();
    let cleanup: InvocationCleanup | undefined;
    let started!: () => void;
    const admission = new Promise<void>(resolve => { started = resolve; });
    let finish!: () => void;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    let opened = 0;
    let acquisitionFinished = false;
    let commandSettled = false;
    let cleanupSettled = false;
    fs.capabilitiesFor = async () => { started(); await wait; acquisitionFinished = true; return fs.capabilities; };
    fs.readStream = () => { opened++; return toByteSource("no"); };
    const pending = format(["file"], "", { fs, signal: controller.signal, registerCleanup(handler) { cleanup = handler; } }).then(
      result => { commandSettled = true; return { result }; },
      (error: unknown) => { commandSettled = true; return { error }; },
    );
    await admission;
    assert.ok(cleanup);
    if (cancelParent) controller.abort(false);
    const closing = cleanup();
    assert.equal(cleanup(), closing);
    const observedClosing = Promise.resolve(closing).then(() => { cleanupSettled = true; });
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(acquisitionFinished, false);
      assert.equal(cleanupSettled, true);
      assert.equal(commandSettled, false);
      assert.equal(opened, 0);
    } finally { finish(); }
    await observedClosing;
    const outcome = await pending;
    if (cancelParent) {
      assert.ok("error" in outcome);
      assert.equal(outcome.error, false);
    } else {
      assert.ok("result" in outcome);
      assert.deepEqual(outcome.result, { exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("fmt: EPIPE: fmt input closed\n") });
    }
    assert.equal(acquisitionFinished, true);
    assert.equal(cleanupSettled, true);
    assert.equal(commandSettled, true);
    assert.equal(opened, 0);
    assert.equal(cleanup(), closing);
  }
});

test("fmt supports declared readFile fallback without metadata", async () => {
  const backing = await fixture({ file: "one two" });
  let maximum: number | undefined;
  const fs = new Proxy(backing, { get(target, key) {
    if (key === "capabilities") return { ...target.capabilities, streamingRead: false, stat: false };
    if (key === "stat" || key === "readStream") return () => { throw new Error("disabled capability"); };
    if (key === "readFile") return async (path: string, options: { signal?: AbortSignal; maxBytes?: number }) => { maximum = options.maxBytes; return backing.readFile(path, options); };
    const member: unknown = Reflect.get(target, key);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  assert.equal((await format(["file"], "", { fs })).stdout.toString(), "one two\n");
  assert.equal(maximum, 32 * 1024 * 1024);
});

test("fmt stops consuming and retires the producer on sink failure", async () => {
  let reads = 0;
  let closed = 0;
  const reason = new FsError("EPIPE");
  const result = await format([], { async *[Symbol.asyncIterator]() {
    try { while (true) { reads++; yield new Uint8Array(5000).fill(97); } }
    finally { closed++; }
  } }, { stdout: { async write() { throw reason; } } });
  assert.equal(result.exitCode, 1);
  assert.ok(reads < 10);
  assert.equal(closed, 1);
});
