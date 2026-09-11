import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CommandRegistry, createCommandArguments, toByteSource, type ByteSource, type CommandContext, type FileSystem, type InvocationCleanup } from "../../src/contracts/index.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
import { fmtCommand } from "../../src/commands/fmt.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/index.js";

interface NativeCase {
  name: string;
  argv: string[];
  stdin: string;
  files: Record<string, string | null>;
  locale: string;
  stdout: string;
  stderr: string;
  status: number;
}

const snapshot = JSON.parse(readFileSync(new URL("./fmt-adversarial.snapshot.json", import.meta.url), "utf8")) as { cases: NativeCase[] };
const quotingSnapshot = JSON.parse(readFileSync(new URL("./fmt-quoting.snapshot.json", import.meta.url), "utf8")) as { cases: NativeCase[] };
const asciiQuotingSnapshot = JSON.parse(readFileSync(new URL("./fmt-ascii-quoting.snapshot.json", import.meta.url), "utf8")) as { cases: NativeCase[] };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

async function format(input: ByteSource, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await fmtCommand().execute({
    command: "fmt", args: [], cwd: "/", env: { LC_ALL: "C" }, fs: new MemoryFileSystem(),
    stdin: input, signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
    ...overrides,
  });
  return { status: result.exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
}

function partition(input: Uint8Array, sizes: readonly number[]): ByteSource {
  return { async *[Symbol.asyncIterator]() {
    const slab = Buffer.alloc(Math.max(...sizes));
    let offset = 0;
    let index = 0;
    try {
      while (offset < input.length) {
        const length = Math.min(sizes[index++ % sizes.length]!, input.length - offset);
        slab.set(input.subarray(offset, offset + length));
        offset += length;
        yield slab.subarray(0, length);
        slab.fill(0xdd);
      }
    } finally { slab.fill(0xee); }
  } };
}

for (const entry of snapshot.cases) test(`fmt independent GNU bytes: ${entry.name}`, async () => {
  const fs = new MemoryFileSystem();
  for (const [path, contents] of Object.entries(entry.files)) {
    if (contents === null) await fs.mkdir(`/${path}`);
    else await fs.writeFile(`/${path}`, Buffer.from(contents, "base64"));
  }
  const argumentValues = createCommandArguments(entry.argv.map(argument => shellValueFromBytes(Buffer.from(argument, "base64"))));
  const input = Buffer.from(entry.stdin, "base64");
  const expected = { status: entry.status, stdout: Buffer.from(entry.stdout, "base64"), stderr: Buffer.from(entry.stderr, "base64") };
  const partitions = input.length < 1024 ? [[1], [7, 2, 1]] : [[4999, 1, 1, 997, 1, 1], [5000, 998, 3]];
  for (const sizes of partitions) {
    assert.deepEqual(await format(partition(input, sizes), { fs, args: argumentValues.args, argumentValues, env: { LC_ALL: entry.locale } }), expected, `chunk sizes ${sizes.join(",")}`);
  }
});

for (const [profile, entries] of [["apostrophe-question-mark", quotingSnapshot.cases], ["ASCII apostrophe", asciiQuotingSnapshot.cases]] as const) for (const entry of entries) test(`fmt GNU ${profile} quoting: ${entry.name}`, async () => {
  const argumentValues = createCommandArguments([shellValueFromBytes(Buffer.from("--")), ...entry.argv.map(argument => shellValueFromBytes(Buffer.from(argument, "base64")))]);
  const expected = { status: entry.status, stdout: Buffer.from(entry.stdout, "base64"), stderr: Buffer.from(entry.stderr, "base64") };
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: entry.locale, FILE: argumentValues.args[1]! } }).use(agentCommands());
  try {
    const direct = await format(toByteSource(""), { args: argumentValues.args, argumentValues, env: { LC_ALL: entry.locale } });
    const result = await shell.exec('fmt -- "$FILE"');
    const registered = { status: result.exitCode, stdout: Buffer.from(result.stdoutBytes), stderr: Buffer.from(result.stderrBytes) };
    assert.deepEqual({ direct, registered }, { direct: expected, registered: expected });
  } finally { await shell.dispose(); }
});

for (const reason of [false, 0, "", null, undefined, NaN]) test(`fmt Shell cancellation ${String(reason)} does not drain opaque metadata`, async () => {
  for (const streamingRead of [true, false]) for (const rejectQuery of [false, true]) {
    const fs: FileSystem = new MemoryFileSystem();
    const admitted = deferred();
    const release = deferred();
    const controller = new AbortController();
    let cleanup!: InvocationCleanup;
    let acquisitions = 0;
    let outputBytes = 0;
    let metadataSettled = false;
    let handlerSettled = false;
    let cleanupSettled = false;
    let execSettled = false;
    let disposeSettled = false;
    let runtimeCleanups = 0;
    fs.capabilitiesFor = async () => {
      admitted.resolve();
      await release.promise;
      metadataSettled = true;
      if (rejectQuery) throw false;
      return { ...fs.capabilities, streamingRead };
    };
    fs.readStream = () => { acquisitions++; return toByteSource("not admitted"); };
    fs.readFile = async () => { acquisitions++; return Buffer.from("not admitted"); };
    const definition = fmtCommand();
    let handler: Promise<unknown> | undefined;
    const shell = new Shell({ fs, commands: new CommandRegistry([{ ...definition, execute(context) {
      const pending = definition.execute({
        ...context,
        registerCleanup(callback) {
          cleanup = callback;
          context.registerCleanup!(() => { runtimeCleanups++; return callback(); });
        },
        stdout: { ...context.stdout, async write(bytes) { outputBytes += bytes.length; await context.stdout.write(bytes); } },
        stderr: { ...context.stderr, async write(bytes) { outputBytes += bytes.length; await context.stderr.write(bytes); } },
      });
      handler = Promise.resolve(pending).then(
        result => { handlerSettled = true; return { result }; },
        (error: unknown) => { handlerSettled = true; return { error }; },
      );
      return pending;
    } }]) });
    const pending = shell.exec("fmt /file", { signal: controller.signal }).then(
      result => { execSettled = true; return { result }; },
      (error: unknown) => { execSettled = true; return { error }; },
    );
    await admitted.promise;
    controller.abort(reason);
    const closing = cleanup();
    assert.equal(cleanup(), closing);
    const observedClosing = Promise.resolve(closing).then(() => { cleanupSettled = true; });
    const disposing = shell.dispose().then(() => { disposeSettled = true; });
    let beforeRelease;
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      await new Promise<void>(resolve => setImmediate(resolve));
      beforeRelease = { metadataSettled, handlerSettled, cleanupSettled, execSettled, disposeSettled, acquisitions, outputBytes };
    } finally { release.resolve(); }
    const outcome = await pending;
    await observedClosing;
    await disposing;
    await handler;
    assert.deepEqual(beforeRelease, { metadataSettled: false, handlerSettled: false, cleanupSettled: true, execSettled: true, disposeSettled: true, acquisitions: 0, outputBytes: 0 });
    assert.ok("error" in outcome);
    assert.equal(outcome.error, controller.signal.reason);
    assert.equal(metadataSettled, true);
    assert.equal(handlerSettled, true);
    assert.equal(acquisitions, 0);
    assert.equal(outputBytes, 0);
    assert.equal(runtimeCleanups, 1);
    assert.equal(cleanup(), closing);
  }
});

for (const reason of [false, 0, "", null, undefined, NaN]) test(`fmt drains reentrant iterator acquisition after cancellation ${String(reason)}`, async () => {
  const fs: FileSystem = new MemoryFileSystem();
  const retirement = deferred();
  const release = deferred();
  const controller = new AbortController();
  let cleanup!: InvocationCleanup;
  let closing: ReturnType<InvocationCleanup> = undefined;
  let returns = 0;
  let settled = false;
  let cleanupSettled = false;
  let observedClosing: Promise<void> | undefined;
  fs.capabilitiesFor = async () => fs.capabilities;
  fs.readStream = () => ({ [Symbol.asyncIterator]() {
    controller.abort(reason);
    closing = cleanup();
    assert.equal(cleanup(), closing);
    observedClosing = Promise.resolve(closing).then(() => { cleanupSettled = true; });
    return {
      async next(): Promise<IteratorResult<Uint8Array>> { assert.fail("read after closed admission"); },
      async return() { returns++; retirement.resolve(); await release.promise; return { done: true, value: undefined }; },
    };
  } });
  const pending = format(toByteSource(""), { fs, args: ["file"], signal: controller.signal, registerCleanup(callback) { cleanup = callback; } }).then(
    result => { settled = true; return { result }; },
    (error: unknown) => { settled = true; return { error }; },
  );
  await retirement.promise;
  let beforeRelease;
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    beforeRelease = { settled, cleanupSettled, returns };
  } finally { release.resolve(); }
  const outcome = await pending;
  await observedClosing;
  assert.deepEqual(beforeRelease, { settled: false, cleanupSettled: false, returns: 1 });
  assert.ok("error" in outcome);
  assert.equal(outcome.error, controller.signal.reason);
  assert.equal(returns, 1);
  assert.equal(cleanup(), closing);
});

test("fmt Shell cancellation and disposal drain acquired reader retirement", async () => {
  const fs: FileSystem = new MemoryFileSystem();
  const admitted = deferred();
  const retirement = deferred();
  const release = deferred();
  const controller = new AbortController();
  let returns = 0;
  let settled = false;
  let disposed = false;
  fs.capabilitiesFor = async () => fs.capabilities;
  fs.readStream = (_path, options) => ({ [Symbol.asyncIterator]() { return {
    next() {
      admitted.resolve();
      return new Promise<IteratorResult<Uint8Array>>((_resolve, reject) => {
        options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true });
      });
    },
    async return() { returns++; retirement.resolve(); await release.promise; return { done: true, value: undefined }; },
  }; } });
  const shell = new Shell({ fs, commands: new CommandRegistry([fmtCommand()]) });
  const pending = shell.exec("fmt /file", { signal: controller.signal }).then(
    result => { settled = true; return { result }; },
    (error: unknown) => { settled = true; return { error }; },
  );
  await admitted.promise;
  controller.abort(false);
  const disposing = shell.dispose().then(() => { disposed = true; });
  await retirement.promise;
  let beforeRelease;
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    beforeRelease = { settled, disposed, returns };
  } finally { release.resolve(); }
  const outcome = await pending;
  await disposing;
  assert.deepEqual(beforeRelease, { settled: false, disposed: false, returns: 1 });
  assert.ok("error" in outcome);
  assert.equal(outcome.error, false);
  assert.equal(returns, 1);
});

for (const reason of [false, 0, "", null, undefined, NaN]) test(`fmt overlapping cancellation retains ${String(reason)} and drains retirement`, async () => {
  const controller = new AbortController();
  const admitted = deferred();
  const retirement = deferred();
  const release = deferred();
  let cleanup!: InvocationCleanup;
  let returns = 0;
  let settled = false;
  const input: ByteSource = { [Symbol.asyncIterator]() { return {
    next() {
      admitted.resolve();
      return new Promise<IteratorResult<Uint8Array>>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
      });
    },
    async return() { returns++; retirement.resolve(); await release.promise; return { done: true, value: undefined }; },
  }; } };
  const pending = format(input, { signal: controller.signal, registerCleanup(handler) { cleanup = handler; } });
  const observed = pending.then(() => { settled = true; assert.fail("cancellation returned success"); }, error => { settled = true; assert.equal(error, controller.signal.reason); });
  await admitted.promise;
  controller.abort(reason);
  const closing = cleanup();
  assert.equal(cleanup(), closing);
  await retirement.promise;
  await new Promise<void>(resolve => setImmediate(resolve));
  const premature = settled;
  release.resolve();
  await closing;
  await observed;
  assert.equal(premature, false);
  assert.equal(returns, 1);
});

for (const mode of ["mapped", "escaping", "cancelled"] as const) {
  for (const reason of [false, 0, "", null, undefined, NaN]) test(`fmt ${mode} failure ${String(reason)} outranks rejecting retirement`, async () => {
    const controller = new AbortController();
    const retirement = deferred();
    const release = deferred();
    const cleanupFailure = new Error("secondary retirement failure");
    const primary = mode === "mapped" ? reason : new Error("stdout failure");
    const errors: unknown[] = [];
    let cleanup!: InvocationCleanup;
    let returns = 0;
    let settled = false;
    const input: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() { return { done: false, value: Buffer.alloc(20000, 97) }; },
      async return(): Promise<IteratorResult<Uint8Array>> { returns++; retirement.resolve(); await release.promise; throw cleanupFailure; },
    }; } };
    const pending = format(input, {
      signal: controller.signal,
      registerCleanup(handler) { cleanup = handler; },
      onInternalError(error) { errors.push(error); },
      stdout: { async write() { if (mode === "cancelled") controller.abort(reason); throw primary; } },
      ...(mode === "escaping" ? { stderr: { async write() { throw reason; } } } : {}),
    }).then(
      result => { settled = true; return { result }; },
      (error: unknown) => { settled = true; return { error }; },
    );
    await retirement.promise;
    const closing = cleanup();
    assert.equal(cleanup(), closing);
    const observedClosing = Promise.resolve(closing).then(
      () => { assert.fail("retirement failure was lost"); },
      error => { assert.equal(error, cleanupFailure); },
    );
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(settled, false);
    } finally { release.resolve(); }
    await observedClosing;
    const outcome = await pending;
    if (mode === "mapped") {
      assert.ok("result" in outcome);
      assert.deepEqual(outcome.result, { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("fmt: internal error\n") });
    } else {
      assert.ok("error" in outcome);
      assert.equal(outcome.error, mode === "cancelled" ? controller.signal.reason : reason);
    }
    assert.deepEqual(errors, mode === "cancelled" ? [] : [primary]);
    assert.equal(returns, 1);
  });
}

test("fmt awaits every sink write without pulling through backpressure", async () => {
  const blocked = deferred();
  const release = deferred();
  let reads = 0;
  let writing = false;
  let writes = 0;
  const stdout: Uint8Array[] = [];
  const input: ByteSource = { async *[Symbol.asyncIterator]() {
    for (let index = 0; index < 12; index++) { reads++; yield Buffer.alloc(5000, 97); }
  } };
  const pending = format(input, { stdout: { async write(bytes) {
    assert.equal(writing, false);
    writing = true;
    if (++writes === 1) { blocked.resolve(); await release.promise; }
    stdout.push(new Uint8Array(bytes));
    writing = false;
  } } });
  await blocked.promise;
  const before = reads;
  await new Promise<void>(resolve => setImmediate(resolve));
  const after = reads;
  release.resolve();
  const result = await pending;
  assert.equal(after, before);
  assert.ok(before < 12);
  assert.equal(result.status, 0);
  assert.deepEqual(result.stderr, Buffer.alloc(0));
  assert.deepEqual(Buffer.concat(stdout), Buffer.concat([Buffer.alloc(60000, 97), Buffer.from("\n")]));
});

for (const script of ["{ read -n1 ignored; fmt -w12 - -; cat; }", "{ fmt -w12 file; fmt -w12; cat; }"]) test(`fmt shares shell stdin without local registry leakage: ${script}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/file", Buffer.from("file words"));
  const commands = new CommandRegistry([fmtCommand(), { name: "cat", async execute(context) {
    for await (const bytes of context.stdin) await context.stdout.write(bytes);
    return { exitCode: 0 };
  } }]);
  const shell = new Shell({ fs, commands });
  try {
    const result = await shell.exec(script, { stdin: "Xone two three four" });
    assert.deepEqual({ status: result.exitCode, stdout: Buffer.from(result.stdoutBytes), stderr: Buffer.from(result.stderrBytes) }, {
      status: 0, stdout: Buffer.from(script.includes("read") ? "one two\nthree four\n" : "file words\nXone two\nthree four\n"), stderr: Buffer.alloc(0),
    });
  } finally { await shell.dispose(); }
});
