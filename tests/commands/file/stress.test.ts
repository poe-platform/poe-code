import assert from "node:assert/strict";
import test from "node:test";
import { FsError, toByteSource, type ByteSource, type FileStat, type ReadStreamOptions } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { classify } from "../../../src/commands/file/classify.js";
import { fixtures } from "./fixtures.js";
import { deferred, proxyFs, run } from "./helpers.js";

test("bounded streaming closes at prefix, passes range/signal, avoids readFile and ignores metadata identity/size", async () => {
  const memory = createMemoryFileSystem(); await memory.writeFile("/entry", Buffer.from("ignored"));
  const stat = await memory.stat("/entry");
  let reads = 0, returned = 0, options: ReadStreamOptions | undefined;
  const fs = proxyFs(memory, {
    async lstat() { return { ...stat, size: NaN, ino: undefined, dev: undefined, identityScope: undefined }; },
    readFile() { throw new Error("whole read forbidden"); },
    readStream(_path: string, supplied: ReadStreamOptions) {
      options = supplied;
      return { [Symbol.asyncIterator]() { return {
        async next() { reads++; return { done: false, value: Buffer.from("hello") }; },
        async return() { returned++; return { done: true, value: undefined }; },
      }; } };
    },
  });
  const result = await run(["-bi", "entry"], { limits: { maxSniffBytes: 5 } }, { fs });
  assert.equal(result.stdout, "text/plain; charset=us-ascii\n"); assert.equal(reads, 1); assert.equal(returned, 1);
  assert.equal(options!.start, 0); assert.equal(options!.endExclusive, 5); assert.equal(options!.chunkSize, 5);
  assert.equal(options!.signal!.aborted, true);
});

test("readFile-only fallback gates known size before read, passes maxBytes, and rejects unknown size", async () => {
  const memory = createMemoryFileSystem(); await memory.writeFile("/entry", Buffer.from('{"ok":1}'));
  const stat = await memory.stat("/entry"); let reads = 0, claimedSize = stat.size;
  const fs = proxyFs(memory, { readStream: undefined,
    async lstat() { return { ...stat, size: claimedSize }; },
    async readFile(path: string, options: { signal: AbortSignal; maxBytes: number }) {
      reads++; assert.equal(options.signal.aborted, false); assert.equal(options.maxBytes, 16); return memory.readFile(path, options);
    },
  });
  const config = { limits: { maxReadFileBytes: 16 } };
  assert.equal((await run(["-bi", "entry"], config, { fs })).stdout, "application/json; charset=us-ascii\n");
  for (const size of [17, 100000000000]) {
    claimedSize = size; const result = await run(["entry"], config, { fs });
    assert.equal(result.exitCode, 1); assert.match(result.stderr, /readFile limit/);
  }
  for (const size of [NaN, -1, Infinity, undefined]) {
    claimedSize = size as number; const result = await run(["entry"], config, { fs });
    assert.equal(result.exitCode, 1); assert.match(result.stderr, /readStream or a known size/);
  }
  assert.equal(reads, 1);
});

test("prefix cancellation reaches VFS before awaiting signal-dependent return cleanup", async () => {
  const memory = createMemoryFileSystem(); await memory.writeFile("/entry", Buffer.from("hello"));
  let returned = false;
  const fs = proxyFs(memory, { readStream(_path: string, options: ReadStreamOptions) {
    return { [Symbol.asyncIterator]() { return {
      async next() { return { done: false, value: Buffer.from("hello") }; },
      async return() {
        if (!options.signal!.aborted) await new Promise<void>(resolve => options.signal!.addEventListener("abort", () => resolve(), { once: true }));
        returned = true;
        throw options.signal!.reason;
      },
    }; } };
  } });
  const result = await run(["-bi", "entry"], { limits: { maxSniffBytes: 5, maxDurationMs: 100 } }, { fs });
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, "text/plain; charset=us-ascii\n"); assert.equal(returned, true);
});

test("limit-error diagnostics still honor the active deadline", async () => {
  await assert.rejects(run(["one", "two"], { limits: { maxEntries: 1, maxDurationMs: 5 } }, { stderr: { write() {
    return new Promise(() => {});
  } } }), /time limit exceeded/);
});

test("readFile gate is not a lease: oversized returned bytes fail after backend allocation", async () => {
  const memory = createMemoryFileSystem(); await memory.writeFile("/entry", Buffer.from("x"));
  let allocated = false;
  const fs = proxyFs(memory, { readStream: undefined, async readFile() { allocated = true; return new Uint8Array(100); } });
  const result = await run(["entry"], { limits: { maxReadFileBytes: 8 } }, { fs });
  assert.equal(allocated, true); assert.equal(result.exitCode, 1); assert.match(result.stderr, /readFile limit/); assert.equal(result.stdout, "");
});

test("metadata size zero does not suppress permission or stream errors", async () => {
  const memory = createMemoryFileSystem(); await memory.writeFile("/entry", new Uint8Array());
  const fs = proxyFs(memory, { readStream() { throw new FsError("EACCES", { path: "/entry" }); } });
  const result = await run(["entry"], {}, { fs });
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, ""); assert.match(result.stderr, /permission denied/);
});

test("JSON requires observed complete object/array; valid prefixes and exact stream boundary are not proof", async () => {
  for (const text of ['{"a":1}', '[1,true]', '  {"a":1}\n']) {
    const full = await run(["-b", "--mime-type", "-"], {}, { stdin: toByteSource(text) });
    assert.equal(full.stdout, "application/json\n");
    const prefix = await run(["-b", "--mime-type", "-"], { limits: { maxSniffBytes: Buffer.byteLength(text) } }, { stdin: toByteSource(text + "junk") });
    assert.equal(prefix.stdout, "text/plain\n");
    const boundary = await run(["-b", "--mime-type", "-"], { limits: { maxSniffBytes: Buffer.byteLength(text) } }, { stdin: toByteSource(text) });
    assert.equal(boundary.stdout, "text/plain\n");
  }
  for (const text of ['{"a":1} trailing', '{"a":1,}', '{/*x*/}', '[1,]', '42', 'true', '"string"']) {
    assert.equal((await run(["-b", "--mime-type", "-"], {}, { stdin: toByteSource(text) })).stdout, "text/plain\n");
  }
});

test("invalid UTF-8, UTF-16, NUL/C1 and truncated complete encodings are binary; prefix splits are tolerated", async () => {
  for (const bytes of [Buffer.from([192, 175]), Buffer.from([237, 160, 128]), Buffer.from([244, 144, 128, 128]), Buffer.from([226, 130]),
    Buffer.from([255, 254, 65]), Buffer.from([255, 254, 0, 216]), Buffer.from([254, 255, 220, 0]),
    Buffer.from("hello\0world"), Buffer.from("hello\u0085world"), Buffer.from([255, 254, 0, 0, 65, 0, 0, 0])]) {
    const result = await run(["-bi", "-"], {}, { stdin: toByteSource(bytes) });
    assert.equal(result.stdout, "application/octet-stream; charset=binary\n", bytes.toString("hex"));
  }
  assert.equal((await run(["-bi", "-"], { limits: { maxSniffBytes: 3 } }, { stdin: toByteSource("a€z") })).stdout, "text/plain; charset=utf-8\n");
});

test("chunk partitioning and reused Buffer ownership do not change complete classification", async () => {
  for (const specimen of fixtures) {
    const source = (async function* () {
      const scratch = Buffer.alloc(3);
      for (let offset = 0; offset < specimen.bytes.length; offset += 3) {
        const length = Math.min(3, specimen.bytes.length - offset);
        scratch.set(specimen.bytes.subarray(offset, offset + length)); yield scratch.subarray(0, length); scratch.fill(255);
      }
    })();
    const result = await run(["-bi", "-"], {}, { stdin: source });
    assert.equal(result.stdout, `${specimen.mime}; charset=${specimen.encoding}\n`, specimen.name);
  }
});

test("signature truncation, invalid PNG dimensions, invalid tar checksum and oversized PE offset stay bounded", () => {
  for (const [name, minimum] of [["png", 33], ["gif", 13], ["gzip", 10], ["sqlite-header", 100], ["elf-header", 64], ["zip-empty", 22]] as const) {
    const specimen = fixtures.find(value => value.name === name)!;
    for (let length = 0; length < minimum; length++) assert.notEqual(classify(specimen.bytes.subarray(0, length), true).mime, specimen.mime, `${name} at ${length}`);
  }
  const png = Buffer.from(fixtures.find(value => value.name === "png")!.bytes); png.writeUInt32BE(0, 16);
  assert.notEqual(classify(png, true).mime, "image/png");
  const tar = Buffer.from(fixtures.find(value => value.name === "tar")!.bytes); tar[0] = 255;
  assert.notEqual(classify(tar, true).mime, "application/x-tar");
  const pe = Buffer.from(fixtures.find(value => value.name === "pe-header")!.bytes); pe.writeUInt32LE(0xffffffff, 60);
  assert.equal(classify(pe, true).mime, "application/x-dosexec");
  let seed = 123456789;
  for (let iteration = 0; iteration < 1000; iteration++) {
    const bytes = Uint8Array.from({ length: iteration % 150 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 24; });
    assert.doesNotThrow(() => classify(bytes, iteration % 2 === 0));
  }
});

test("stream late read and return failures are not mistaken for EOF success", async () => {
  const denied = new FsError("EACCES", { path: "/entry", message: "late stream permission denied" });
  const memory = createMemoryFileSystem(); await memory.writeFile("/entry", Buffer.from("x"));
  const fs = proxyFs(memory, { readStream() { return (async function* () { yield Buffer.from("hello"); throw denied; })(); } });
  const result = await run(["entry"], {}, { fs });
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, ""); assert.match(result.stderr, /late stream permission denied/);
  const reason = new Error("return failed");
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { return { done: false, value: Buffer.from("abcd") }; }, async return() { throw reason; },
  }; } };
  await assert.rejects(run(["-"], { limits: { maxSniffBytes: 4 } }, { stdin }), error => error === reason);
});

test("entry and argument preflight happen before filesystem access", async () => {
  let reads = 0;
  const fs = proxyFs(createMemoryFileSystem(), { async lstat() { reads++; throw new Error("unexpected"); } });
  for (const limits of [{ maxEntries: 1 }, { maxArgumentBytes: 2 }]) {
    const result = await run(["one", "two"], { limits }, { fs });
    assert.equal(result.exitCode, 1); assert.match(result.stderr, /entry|argument/);
  }
  assert.equal(reads, 0);
});

test("shared input/output/chunk/step limits include multiple operands and bounded diagnostics", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/one", Buffer.from("hello")); await fs.writeFile("/two", Buffer.from("world"));
  const input = await run(["-b", "one", "two"], { limits: { maxInputBytes: 9 } }, { fs });
  assert.equal(input.exitCode, 1); assert.equal(input.stdout, "ASCII text\n"); assert.match(input.stderr, /input limit/);
  for (const limits of [{ maxChunkBytes: 4 }, { maxSteps: 1 }]) {
    const result = await run(["-b", "-"], { limits }, { stdin: toByteSource("hello") });
    assert.equal(result.exitCode, 1); assert.match(result.stderr, /chunk|step/);
  }
  const output = await run(["one", "two"], { limits: { maxOutputBytes: 4 } }, { fs });
  assert.equal(output.exitCode, 1); assert.ok(output.stdoutBytes.length + output.stderrBytes.length <= 4);
});

test("empty-chunk producers have finite step quotas and yield to timer cancellation", async () => {
  const source = () => (async function* () { while (true) yield new Uint8Array(); })();
  const result = await run(["-"], { limits: { maxSteps: 12 } }, { stdin: source() });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /step limit/);
  const controller = new AbortController(), reason = new FsError("ENOENT", { message: "abort empty stream" });
  const running = run(["-"], {}, { stdin: source(), signal: controller.signal });
  const check = assert.rejects(running, error => error === reason);
  const timer = setTimeout(() => controller.abort(reason), 5);
  try { await check; } finally { clearTimeout(timer); }
});

test("abort during pending stream read returns upstream and observes late rejection", async () => {
  const started = deferred(), controller = new AbortController(), reason = new FsError("ENOENT", { message: "cancel read" });
  let rejectRead!: (reason: unknown) => void, returned = false;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    next() { started.resolve(); return new Promise((_resolve, reject) => { rejectRead = reject; }); },
    async return() { returned = true; return { done: true, value: undefined }; },
  }; } };
  const running = run(["-"], {}, { stdin, signal: controller.signal });
  const check = assert.rejects(running, error => error === reason);
  await started.promise; controller.abort(reason); await check;
  rejectRead(new Error("late rejected read")); await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(returned, true);
});

test("pending metadata and whole-file reads propagate signal and observe late rejections", async () => {
  for (const method of ["lstat", "readFile"] as const) {
    const memory = createMemoryFileSystem(); await memory.writeFile("/entry", Buffer.from("hello"));
    const started = deferred(), controller = new AbortController(), reason = new FsError("EACCES", { message: "cancel host" });
    let rejectHost!: (reason: unknown) => void, suppliedSignal: AbortSignal | undefined;
    const fs = proxyFs(memory, { readStream: undefined, [method](_path: string, options: { signal: AbortSignal }) {
      suppliedSignal = options.signal; started.resolve(); return new Promise<FileStat | Uint8Array>((_resolve, reject) => { rejectHost = reject; });
    } });
    const running = run(["entry"], {}, { fs, signal: controller.signal });
    const check = assert.rejects(running, error => error === reason);
    await started.promise; controller.abort(reason); await check;
    assert.equal(suppliedSignal!.aborted, true); rejectHost(new Error("late host failure"));
    await new Promise<void>(resolve => setImmediate(resolve));
  }
});

test("family deadline interrupts uncooperative host operations without claiming to stop their effects", async () => {
  const fs = proxyFs(createMemoryFileSystem(), { lstat() { return new Promise(() => {}); } });
  await assert.rejects(run(["entry"], { limits: { maxDurationMs: 5 } }, { fs }), /time limit exceeded/);
});

test("deadline does not retry a blocked diagnostic sink after timeout", async () => {
  let writes = 0;
  await assert.rejects(run(["missing"], { limits: { maxDurationMs: 5 } }, { stderr: { write() {
    writes++; return new Promise(() => {});
  } } }), /time limit exceeded/);
  assert.equal(writes, 1);
});

test("sink backpressure blocks next operand; rejection and abort retain their identities", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/one", Buffer.from("hello")); await fs.writeFile("/two", Buffer.from("world"));
  const started = deferred(), controller = new AbortController(), reason = new FsError("EIO", { message: "abort sink" });
  let inspected = 0, rejectWrite!: (reason: unknown) => void;
  const proxy = proxyFs(fs, { async lstat(path: string) { inspected++; return fs.lstat(path); } });
  const running = run(["one", "two"], {}, { fs: proxy, signal: controller.signal, stdout: { write() {
    started.resolve(); return new Promise((_resolve, reject) => { rejectWrite = reject; });
  } } });
  const check = assert.rejects(running, error => error === reason);
  await started.promise; assert.equal(inspected, 1); controller.abort(reason); await check;
  rejectWrite(new Error("late write failure")); await new Promise<void>(resolve => setImmediate(resolve));
  const broken = new FsError("EPIPE", { message: "sink closed" });
  await assert.rejects(run(["one"], {}, { fs, stdout: { async write() { throw broken; } } }), error => error === broken);
  await assert.rejects(run(["missing"], {}, { fs, stderr: { async write() { throw broken; } } }), error => error === broken);
});
