import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  Shell, MockS3Client, S3FileSystem, createMemoryFileSystem, createReadOnlyFileSystem,
  collectBytes, createBytePipe, pipeBytes, standardCommands, createByteCommands,
  type ByteSource, type FileSystem, type ReadStreamOptions, type ShellResult,
} from "../../../src/index.js";
import { collect } from "../../../src/commands/internal.js";
import { vectors } from "./expectations.js";

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const signal = (): AbortSignal => new AbortController().signal;
const timeout = { timeout: 15_000 };

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

function borrowed(kind: "Buffer" | "Uint8Array", events: string[]): ByteSource {
  const backing = kind === "Buffer" ? Buffer.alloc(11, 0x7e) : new Uint8Array(11).fill(0x7e);
  const window = backing.subarray(4, 7);
  assert.equal(window.byteOffset - backing.byteOffset, 4);
  return (async function* () {
    try {
      for (const [index, input] of vectors.chunks.entries()) {
        window.set(Buffer.from(input, "hex"));
        events.push(`yield:${index}:${hex(window)}`);
        yield window;
        events.push(`next:${index}`);
      }
    } finally {
      window.fill(0);
      events.push("finally:zero");
      assert.equal(backing[3], 0x7e);
      assert.equal(backing[7], 0x7e);
    }
  })();
}

function report(id: string, actual: unknown, expected: unknown, events: readonly string[] = []): void {
  console.log(`OWNERSHIP ${JSON.stringify({ id, actual, expected, events })}`);
  assert.deepEqual(actual, expected);
}

function shellFor(context: TestContext, fs: FileSystem = createMemoryFileSystem()): Shell {
  const shell = new Shell({ fs }).use(standardCommands());
  for (const command of createByteCommands()) shell.register(command);
  context.after(async () => { await shell.dispose(); });
  return shell;
}

async function named(kind: "Buffer" | "Uint8Array", events: string[]): Promise<FileSystem> {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from(vectors.whole, "hex"));
  fs.readStream = (path: string, options?: ReadStreamOptions): ByteSource => {
    assert.equal(path, "/input");
    assert.ok(options?.signal);
    options.signal.throwIfAborted();
    return borrowed(kind, events);
  };
  return fs;
}

function resultBytes(result: ShellResult): object {
  return { stdout: hex(result.stdoutBytes), stderr: hex(result.stderrBytes), exitCode: result.exitCode };
}

const success = (stdout: string): object => ({ stdout, stderr: "", exitCode: 0 });

test("01 contract collector snapshots borrowed Buffer windows", timeout, async () => {
  const events: string[] = [];
  const result = await collectBytes(borrowed("Buffer", events), { maxBytes: 6 });
  assert.deepEqual(events, vectors.events);
  report("01", hex(result), vectors.whole, events);
});

for (const [id, kind] of [["02", "Buffer"], ["03", "Uint8Array"]] as const) {
  test(`${id} shared collector ${kind} next-read/finalizer ownership`, timeout, async () => {
    const events: string[] = [];
    const result = await collect(borrowed(kind, events), signal(), 6);
    assert.deepEqual(events, vectors.events);
    report(id, hex(result), vectors.whole, events);
  });
}

for (const [id, kind, command, expected] of [
  ["04", "Buffer", "tail -n 1 /input", vectors.whole],
  ["05", "Uint8Array", "tail -n 1 /input", vectors.whole],
  ["06", "Buffer", "tail -c 4 /input", vectors.tail4],
  ["07", "Uint8Array", "tail -c 4 /input", vectors.tail4],
] as const) {
  test(`${id} public named VFS ${command} ${kind}`, timeout, async context => {
    const events: string[] = [];
    const result = await shellFor(context, await named(kind, events)).exec(command);
    assert.deepEqual(events, vectors.events);
    report(id, resultBytes(result), success(expected), events);
  });
}

test("08 public stdin cursor owns borrowed Buffer windows", timeout, async context => {
  const events: string[] = [];
  const result = await shellFor(context).exec("tail -c 4", { stdin: borrowed("Buffer", events) });
  assert.deepEqual(events, vectors.events);
  report("08", resultBytes(result), success(vectors.tail4), events);
});

test("09 public stdout capture owns bytes after awaited write", timeout, async context => {
  const events: string[] = [];
  const shell = shellFor(context);
  shell.register({ name: "emit-owned", async execute(command) {
    const backing = Buffer.alloc(11, 0x7e);
    const window = backing.subarray(4, 7);
    try {
      for (const [index, input] of vectors.chunks.entries()) {
        window.set(Buffer.from(input, "hex"));
        await command.stdout.write(window);
        events.push(`write-complete:${index}`);
      }
    } finally { window.fill(0); events.push("finally:zero"); }
    return { exitCode: 0 };
  } });
  const accepted: string[] = [];
  const result = await shell.exec("emit-owned", { stdout: { async write(bytes) {
    accepted.push(hex(bytes));
    events.push(`external-accept:${accepted.length - 1}`);
  } } });
  assert.deepEqual(events, ["external-accept:0", "write-complete:0", "external-accept:1", "write-complete:1", "finally:zero"]);
  assert.deepEqual(accepted, vectors.chunks);
  report("09", resultBytes(result), success(vectors.whole), events);
});

test("10 byte pipe awaited write reuse with acceptance handshake", timeout, async context => {
  const events: string[] = [];
  const pipe = createBytePipe({ highWaterMark: 3 });
  context.after(async () => { await pipe.abort(); });
  const window = Buffer.alloc(9).subarray(3, 6);
  window.set(Buffer.from(vectors.chunks[0]!, "hex"));
  await pipe.writable.write(window);
  events.push("first-write-complete");
  window.set(Buffer.from(vectors.chunks[1]!, "hex"));
  let completed = false;
  const second = pipe.writable.write(window).then(() => { completed = true; events.push("second-write-complete"); });
  await Promise.resolve();
  assert.equal(completed, false);
  const iterator = pipe.readable[Symbol.asyncIterator]();
  const first = await iterator.next();
  assert.equal(first.done, false);
  const firstHex = hex(first.value!);
  events.push(`first-read:${firstHex}`);
  await second;
  window.fill(0);
  events.push("after-write:zero");
  const next = await iterator.next();
  assert.equal(next.done, false);
  const nextHex = hex(next.value!);
  await pipe.close();
  assert.equal((await iterator.next()).done, true);
  report("10", firstHex + nextHex, vectors.whole, events);
});

test("11 public named cat consumes before next-read reuse", timeout, async context => {
  const events: string[] = [];
  const result = await shellFor(context, await named("Buffer", events)).exec("cat /input");
  assert.deepEqual(events, vectors.events);
  report("11", resultBytes(result), success(vectors.whole), events);
});

test("12 public named head captures before early finalizer zero", timeout, async context => {
  const events: string[] = [];
  const result = await shellFor(context, await named("Buffer", events)).exec("head -c 2 /input");
  assert.deepEqual(events, ["yield:0:00ffc3", "finally:zero"]);
  report("12", resultBytes(result), success(vectors.prefix2), events);
});

test("13 public cat tee base64 pipeline preserves VFS bytes/effects", timeout, async context => {
  const events: string[] = [];
  const fs = await named("Buffer", events);
  const result = await shellFor(context, fs).exec("cat /input | tee /out | base64 -w 0");
  assert.deepEqual(events, vectors.events);
  const actual = { ...resultBytes(result), file: hex(await fs.readFile("/out")) };
  report("13", actual, { ...success(vectors.base64), file: vectors.whole }, events);
});

test("14 readonly named-stream copy isolates shared line collector", timeout, async context => {
  const events: string[] = [];
  const fs = createReadOnlyFileSystem(await named("Buffer", events));
  const result = await shellFor(context, fs).exec("tail -n 1 /input");
  assert.deepEqual(events, vectors.events);
  report("14", resultBytes(result), success(vectors.whole), events);
});

test("15 memory awaited writes and returned read bytes are independent", timeout, async () => {
  const observed: string[] = [];
  const events: string[] = [];
  for (const kind of ["Buffer", "Uint8Array"] as const) {
    const fs = createMemoryFileSystem();
    const backing = kind === "Buffer" ? Buffer.alloc(12) : new Uint8Array(12);
    const window = backing.subarray(3, 9);
    window.set(Buffer.from(vectors.whole, "hex"));
    await fs.writeFile("/file", window);
    window.fill(0);
    const returned = await fs.readFile("/file");
    observed.push(hex(returned));
    returned.fill(0);
    for await (const chunk of fs.readStream("/file", { chunkSize: 2 })) chunk.fill(0);
    observed.push(hex(await fs.readFile("/file")));
    await fs.writeStream("/stream", borrowed(kind, events));
    observed.push(hex(await fs.readFile("/stream")));
  }
  assert.deepEqual(events, [...vectors.events, ...vectors.events]);
  report("15", observed, Array<string>(6).fill(vectors.whole), events);
});

test("16 readonly readFile snapshots delegate Buffer storage", timeout, async () => {
  const delegate = createMemoryFileSystem();
  const backing = Buffer.alloc(12, 0x7e);
  const stored = backing.subarray(3, 9);
  stored.set(Buffer.from(vectors.whole, "hex"));
  delegate.readFile = async () => stored;
  const fs = createReadOnlyFileSystem(delegate);
  const returned = await fs.readFile("/input");
  const original = hex(returned);
  returned.fill(0);
  const next = await fs.readFile("/input");
  stored.fill(0);
  report("16", [original, hex(next), backing[2], backing[9]], [vectors.whole, vectors.whole, 0x7e, 0x7e]);
  await assert.rejects(fs.writeFile("/input", new Uint8Array()), { code: "EROFS", path: "/input" });
});

test("17 readonly stream snapshots before consumer mutation and finalizer", timeout, async () => {
  const delegate = createMemoryFileSystem();
  const stored = Buffer.alloc(9).subarray(3, 6);
  const events: string[] = [];
  delegate.readStream = async function* () {
    try {
      stored.set(Buffer.from(vectors.chunks[0]!, "hex"));
      yield stored;
      assert.equal(hex(stored), vectors.chunks[0]);
      events.push("consumer-did-not-mutate-storage");
      stored.set(Buffer.from(vectors.chunks[1]!, "hex"));
      yield stored;
    } finally { stored.fill(0); events.push("finally:zero"); }
  };
  const iterator = createReadOnlyFileSystem(delegate).readStream("/input")[Symbol.asyncIterator]();
  const first = await iterator.next();
  assert.equal(first.done, false);
  const original = hex(first.value!);
  first.value!.fill(0);
  const second = await iterator.next();
  assert.equal(second.done, false);
  await iterator.return?.();
  report("17", [original, hex(second.value!), ...events], [...vectors.chunks, "consumer-did-not-mutate-storage", "finally:zero"]);
});

test("18 S3 mock backed FS snapshots writes and readonly read bytes", timeout, async () => {
  const mock = new MockS3Client({ buckets: ["owned"] });
  const fs = new S3FileSystem({ transport: mock, bucket: "owned" });
  assert.ok(fs.readStream);
  assert.ok(fs.writeStream);
  const bytes = Buffer.alloc(12).subarray(3, 9);
  bytes.set(Buffer.from(vectors.whole, "hex"));
  await fs.writeFile("/file", bytes);
  bytes.fill(0);
  const first = await fs.readFile("/file");
  const original = hex(first);
  first.fill(0);
  for await (const chunk of fs.readStream("/file")) chunk.fill(0);
  const readonly = createReadOnlyFileSystem(fs);
  (await readonly.readFile("/file")).fill(0);
  const events: string[] = [];
  await fs.writeStream("/stream", borrowed("Buffer", events));
  report("18", [original, hex(await fs.readFile("/file")), hex(await fs.readFile("/stream"))], Array<string>(3).fill(vectors.whole), events);
});

test("19 collector byte-limit and sink-error preserve cleanup/error identity", timeout, async () => {
  const events: string[] = [];
  await assert.rejects(collectBytes(borrowed("Buffer", events), { maxBytes: 2 }), { code: "EFBIG" });
  assert.deepEqual(events, ["yield:0:00ffc3", "finally:zero"]);
  const reason = new Error("owned-sink-failure");
  const rejected: string[] = [];
  await assert.rejects(pipeBytes(borrowed("Buffer", rejected), { async write() { throw reason; } }), error => error === reason);
  assert.deepEqual(rejected, ["yield:0:00ffc3", "finally:zero"]);
  report("19", [events, rejected], [["yield:0:00ffc3", "finally:zero"], ["yield:0:00ffc3", "finally:zero"]]);
});

test("20 public sink acceptance barrier and cancellation finalize named source", timeout, async context => {
  const events: string[] = [];
  const controller = new AbortController();
  const reason = new Error("owned-cancellation");
  const entered = deferred();
  const released = deferred();
  context.after(() => { released.resolve(); });
  const shell = shellFor(context, await named("Buffer", events));
  const execution = shell.exec("cat /input", { signal: controller.signal, stdout: { async write(bytes) {
    assert.equal(hex(bytes), vectors.chunks[0]);
    entered.resolve();
    await released.promise;
  } } });
  const rejected = assert.rejects(execution, error => error === reason);
  await entered.promise;
  assert.deepEqual(events, ["yield:0:00ffc3"]);
  controller.abort(reason);
  released.resolve();
  await rejected;
  await shell.dispose();
  report("20", events, ["yield:0:00ffc3", "finally:zero"]);
});
