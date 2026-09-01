import assert from "node:assert/strict";
import { test } from "node:test";
import { FsError, type ByteSource, type FileStat, type WriteFileOptions } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { ReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { createSplitCommands } from "../../../src/commands/split/index.js";
import { chunks, files, run, wrapped } from "./helpers.js";

test("bounded settings reject invalid options without registry work", () => {
  for (const value of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createSplitCommands({ limits: { maxFiles: value } }), RangeError);
  }
  assert.deepEqual(createSplitCommands().map(command => command.name), ["split"]);
});

test("GNU size unit grammar distinguishes accepted and rejected spellings", async () => {
  for (const value of ["1g", "1t", "1p", "1e", "1z", "1y", "1r", "1q", "1B", "+K", " K", "0K"]) {
    const result = await run(["-b", value]);
    assert.equal(result.exitCode, 1, value);
    assert.match(result.stderr, /invalid number of bytes/);
  }
  for (const value of ["K", "1mB", "1miB", " +2", "1T", "1P"]) {
    const result = await run(["-b", value], "abc");
    assert.equal(result.exitCode, 0, `${value}: ${result.stderr}`);
    assert.equal(Buffer.concat(Object.values(await files(result.fs)).map(hex => Buffer.from(hex, "hex"))).toString(), "abc");
  }
});

test("binary input survives every chunk boundary and buffer reuse", async () => {
  const input = Uint8Array.from({ length: 513 }, (_, index) => index % 19 === 0 ? 10 : index % 256);
  for (const args of [["-l3"], ["-b17"], ["-C23"]]) {
    const baseline = await run(args, input);
    assert.equal(baseline.exitCode, 0);
    for (const size of [1, 2, 7, 16, 17, 23, 64, 1024]) {
      const actual = await run(args, chunks(input, size, true), { limits: { maxChunkBytes: 11 } });
      assert.equal(actual.exitCode, 0, `${args} chunk ${size}: ${actual.stderr}`);
      assert.deepEqual(await files(actual.fs), await files(baseline.fs), `${args} chunk ${size}`);
    }
  }
});

test("empty input creates no files and does not truncate existing files", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/xaa", Buffer.from("keep"));
  for (const args of [[], ["-b3"], ["-C3"]]) assert.equal((await run(args, "", {}, { fs })).exitCode, 0);
  assert.equal(Buffer.from(await fs.readFile("/xaa")).toString(), "keep");
});

test("empty input ignores output directories without weakening input alias guards", async () => {
  for (const named of [false, true]) {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/xaa");
    await fs.writeFile("/input", Buffer.alloc(0));
    const empty = await run(named ? ["input"] : [], "", {}, { fs });
    assert.equal(empty.exitCode, 0, empty.stderr);
    assert.equal((await fs.stat("/xaa")).type, "directory");
    if (named) await fs.writeFile("/input", Buffer.from("a"));
    const nonempty = await run(named ? ["input"] : [], "a", {}, { fs });
    assert.equal(nonempty.exitCode, 1);
    assert.match(nonempty.stderr, /illegal operation on a directory/);
  }
});

test("suffix exhaustion retains successful outputs and leaves next name alone", async () => {
  for (const args of [["-a1", "-db1"], ["--numeric-suffixes=98", "-b1"]]) {
    const result = await run(args, "abcdefghijkl");
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /output file suffixes exhausted/);
    const expectedCount = args[0] === "-a1" ? 10 : 2;
    assert.equal(Object.keys(await files(result.fs)).length, expectedCount);
  }
});

test("suffix width and file limits preserve earlier files", async () => {
  const capped = await run(["-db1"], "x".repeat(91), { limits: { maxSuffixLength: 2 } });
  assert.equal(capped.exitCode, 1);
  assert.match(capped.stderr, /suffix length limit/);
  assert.equal(Object.keys(await files(capped.fs)).length, 90);
  const count = await run(["-b1"], "abcd", { limits: { maxFiles: 2 } });
  assert.equal(count.exitCode, 1);
  assert.match(count.stderr, /file limit/);
  assert.deepEqual(await files(count.fs), { xaa: "61", xab: "62" });
});

test("output limit leaves completed files and the actual partial current file", async () => {
  const result = await run(["-b3"], chunks(Buffer.from("abcdefghi"), 1), { limits: { maxOutputBytes: 5 } });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /output limit/);
  assert.deepEqual(await files(result.fs), { xaa: "616263", xab: "6465" });
});

test("input and work limits preserve partial output without reading indefinitely", async () => {
  const capped = await run(["-b4"], chunks(Buffer.from("abcdefghi"), 1), { limits: { maxInputBytes: 5 } });
  assert.equal(capped.exitCode, 1);
  assert.deepEqual(await files(capped.fs), { xaa: "61626364", xab: "65" });
  let pulled = 0;
  const input = (async function* () { while (true) { pulled++; yield new Uint8Array(); } })();
  const empty = await run([], input, { limits: { maxSteps: 10 } });
  assert.equal(empty.exitCode, 1);
  assert.equal(pulled, 10);
  assert.deepEqual(await files(empty.fs), {});
});

test("argument, line-bytes window and numeric limits fail before effects", async () => {
  for (const [args, options] of [
    [["-C9"], { limits: { maxBufferBytes: 8 } }],
    [["-b2"], { limits: { maxArgumentBytes: 2 } }],
    [["-a129"], {}], [["-b9007199254740992"], {}], [["--numeric-suffixes=100"], {}],
    [["-l1", "-b2"], {}], [["--additional-suffix=/bad"], {}], [["--filter=anything"], {}],
  ] as const) {
    const result = await run(args, "abc", options);
    assert.equal(result.exitCode, 1, String(args));
    assert.deepEqual(await files(result.fs), {});
  }
});

test("typed disk-full failure retains earlier files and partial overwritten file", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/xab", Buffer.from("PREEXISTING"));
  const limited = wrapped(fs, { async writeStream(path, source, options) {
    if (path !== "/xab") return fs.writeStream(path, source, options);
    await fs.writeFile(path, Buffer.alloc(0), options);
    for await (const chunk of source) {
      await fs.appendFile(path, chunk.subarray(0, 1), options);
      throw new FsError("ENOSPC", { path, syscall: "write" });
    }
  } });
  const result = await run(["-b3"], "abcdefghi", {}, { fs: limited });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "split: no space left on device, write '/xab'\n");
  assert.deepEqual(await files(fs), { xaa: "616263", xab: "64" });
});

test("read failure preserves current streaming bytes", async () => {
  const source = (async function* () { yield Buffer.from("ab"); throw new FsError("EIO", { path: "/source" }); })();
  const result = await run(["-b4"], source);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "split: input/output error '/source'\n");
  assert.deepEqual(await files(result.fs), { xaa: "6162" });
});

test("same input via spelling, symlink and hardlink is rejected before acquisition", async () => {
  for (const alias of ["literal", "symlink", "hardlink"]) {
    const fs = createMemoryFileSystem();
    const input = alias === "literal" ? "/xaa" : "/input";
    await fs.writeFile(input, Buffer.from("ORIGINAL"));
    if (alias === "symlink") await fs.symlink(input, "/xaa");
    if (alias === "hardlink") await fs.link(input, "/xaa");
    let acquired = false;
    const observed = wrapped(fs, { readStream() { acquired = true; throw new Error("must not read aliased input"); } });
    const result = await run(["-b2", input], "", {}, { fs: observed });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /would overwrite input/);
    assert.equal(acquired, false);
    assert.equal(Buffer.from(await fs.readFile(input)).toString(), "ORIGINAL");
  }
});

test("later output alias to input retains earlier completed output", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("abcdef"));
  await fs.link("/input", "/xab");
  const result = await run(["-b2", "input"], "", {}, { fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /would overwrite input/);
  assert.equal(Buffer.from(await fs.readFile("/xaa")).toString(), "ab");
  assert.equal(Buffer.from(await fs.readFile("/input")).toString(), "abcdef");
});

test("output aliases earlier output cannot silently erase successful segment", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/xaa", Buffer.from("ORIGINAL"));
  await fs.link("/xaa", "/xab");
  const result = await run(["-b2"], "abcdef", {}, { fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /aliases an earlier output/);
  assert.equal(Buffer.from(await fs.readFile("/xaa")).toString(), "ab");
  assert.equal(Buffer.from(await fs.readFile("/xab")).toString(), "ab");
});

test("ordinary existing symlink output overwrites its distinct target", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("abcdef"));
  await fs.writeFile("/target", Buffer.from("ORIGINAL"));
  await fs.symlink("/target", "/xaa");
  const result = await run(["-b3", "input"], "", {}, { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await fs.readlink("/xaa"), "/target");
  assert.equal(Buffer.from(await fs.readFile("/target")).toString(), "abc");
});

test("dangling output symlink preserves link and creates target", async () => {
  const fs = createMemoryFileSystem();
  await fs.symlink("/missing", "/xaa");
  const result = await run(["-b2"], "abc", {}, { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await fs.readlink("/xaa"), "/missing");
  assert.equal(Buffer.from(await fs.readFile("/missing")).toString(), "ab");
  assert.equal(Buffer.from(await fs.readFile("/xab")).toString(), "c");
});

test("exclusive missing-output race never truncates raced file", async () => {
  const fs = createMemoryFileSystem();
  const racing = wrapped(fs, { async writeStream(path, source, options) {
    assert.equal(options?.flag, "wx");
    await fs.writeFile(path, Buffer.from("RACED"));
    return fs.writeStream(path, source, options);
  } });
  const result = await run(["-b2"], "abc", {}, { fs: racing });
  assert.equal(result.exitCode, 1);
  assert.equal(Buffer.from(await fs.readFile("/xaa")).toString(), "RACED");
});

test("unknown identity fails closed but truthful comparison enables overwrite", async () => {
  for (const answer of [undefined, "distinct", "same", "invalid"] as const) {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", Buffer.from("abcdef"));
    await fs.writeFile("/xaa", Buffer.from("OLD"));
    const opaque = (stat: FileStat): FileStat => {
      const { identityScope: ignoredIdentityScope, dev: ignoredDev, ino: ignoredIno, ...rest } = stat;
      return rest;
    };
    const target = wrapped(fs, {
      async stat(path, options) { return opaque(await fs.stat(path, options)); },
      async lstat(path, options) { return opaque(await fs.lstat(path, options)); },
      ...(answer === undefined ? {} : { async compareEntry() { return answer as "distinct"; } }),
    });
    const uncomparable = answer === undefined ? new Proxy(target, { get(object, key) { return key === "compareEntry" ? undefined : Reflect.get(object, key); } }) : target;
    const result = await run(["-b3", "input"], "", {}, { fs: uncomparable });
    assert.equal(result.exitCode, answer === "distinct" ? 0 : 1);
    assert.equal(Buffer.from(await fs.readFile("/xaa")).toString(), answer === "distinct" ? "abc" : "OLD");
    if (answer === undefined) assert.match(result.stderr, /cannot establish/);
    if (answer === "same") assert.match(result.stderr, /would overwrite input/);
    if (answer === "invalid") assert.match(result.stderr, /invalid entry comparison/);
  }
});

test("readonly, missing parent, directory, invalid path and denial preserve effects", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/dir");
  for (const [args, backend, message] of [
    [["-b2"], new ReadOnlyFileSystem(fs), /read-only file system/],
    [["-b2", "-", "missing/part"], fs, /no such file or directory/],
    [["-b2", "dir"], fs, /illegal operation on a directory/],
    [["-b2", "-", "bad\0"], fs, /without NUL/],
    [["-b2"], wrapped(fs, { async writeStream(path) { throw new FsError("EACCES", { path }); } }), /permission denied/],
  ] as const) {
    const result = await run(args, "abc", {}, { fs: backend });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, message);
    assert.deepEqual(await files(fs), {});
  }
  await fs.mkdir("/xaa");
  const directory = await run(["-b2"], "abc", {}, { fs });
  assert.equal(directory.exitCode, 1);
  assert.match(directory.stderr, /illegal operation on a directory/);
});

test("writeFile-only fallback has bounded per-segment publication", async () => {
  const fs = createMemoryFileSystem();
  const fallback = wrapped(fs, { capabilities: { ...fs.capabilities, streamingWrite: false } });
  const ok = await run(["-b3"], "abcdefg", { limits: { maxBufferBytes: 3 } }, { fs: fallback });
  assert.equal(ok.exitCode, 0);
  assert.deepEqual(await files(fs), { xaa: "616263", xab: "646566", xac: "67" });
  await fs.writeFile("/yaa", Buffer.from("UNCHANGED"));
  const limited = await run(["-l1", "-", "y"], "123456", { limits: { maxBufferBytes: 3 } }, { fs: fallback });
  assert.equal(limited.exitCode, 1);
  assert.equal(Buffer.from(await fs.readFile("/yaa")).toString(), "UNCHANGED");
});

test("readFile fallback receives and enforces byte cap", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("abcdef"));
  let maximum: number | undefined;
  const fallback = wrapped(fs, { capabilities: { ...fs.capabilities, streamingRead: false }, async readFile(path, options) {
    maximum = options?.maxBytes;
    return fs.readFile(path);
  } });
  const result = await run(["-b2", "input"], "", { limits: { maxBufferBytes: 3 } }, { fs: fallback });
  assert.equal(maximum, 3);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /read buffer limit/);
  assert.deepEqual(await files(fs), { input: "616263646566" });
});

test("streaming writer applies backpressure and owns yielded buffers", async () => {
  const fs = createMemoryFileSystem();
  let produced = 0;
  let consumed = 0;
  const input = (async function* () {
    const buffer = new Uint8Array(2);
    for (const value of [1, 2, 3, 4]) {
      assert.ok(produced <= consumed + 1);
      buffer.fill(value);
      produced++;
      yield buffer;
    }
    buffer.fill(99);
  })();
  const observed: Uint8Array[] = [];
  const slow = wrapped(fs, { async writeStream(path, source, options) {
    const held: Uint8Array[] = [];
    for await (const chunk of source) {
      await new Promise(resolve => setTimeout(resolve, 1));
      held.push(chunk);
      observed.push(chunk);
      consumed++;
    }
    await fs.writeFile(path, Buffer.concat(held), options);
  } });
  const result = await run(["-b4"], input, {}, { fs: slow });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(observed.map(chunk => [...chunk]), [[1, 1], [2, 2], [3, 3], [4, 4]]);
  assert.deepEqual(await files(fs), { xaa: "01010202", xab: "03030404" });
});

test("large incoming chunk is sliced without a producer-chunk refusal", async () => {
  const fs = createMemoryFileSystem();
  const input = Buffer.alloc(2 * 1024 * 1024 + 7, 255);
  input[1023] = 10;
  let maximum = 0;
  let count = 0;
  const streaming = wrapped(fs, { async writeStream(path, source, options) {
    const owned: Uint8Array[] = [];
    for await (const chunk of source) { maximum = Math.max(maximum, chunk.length); count++; owned.push(chunk); }
    await fs.writeFile(path, Buffer.concat(owned), options);
  } });
  const result = await run(["-b1M"], input, { limits: { maxChunkBytes: 4096, maxBufferBytes: 8 } }, { fs: streaming });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(maximum, 4096);
  assert.ok(count > 500);
  assert.deepEqual(Buffer.concat(await Promise.all(["xaa", "xab", "xac"].map(name => fs.readFile(`/${name}`)))), input);
});

test("cancellation preserves exact errno-shaped reason and partial output", async () => {
  const fs = createMemoryFileSystem();
  const controller = new AbortController();
  const reason = new FsError("ENOENT", { message: "abort reason is not a missing file" });
  const source = (async function* () {
    yield Buffer.from("abc");
    controller.abort(reason);
    yield Buffer.from("def");
  })();
  await assert.rejects(run(["-b6"], source, {}, { fs, signal: controller.signal }), error => error === reason);
  assert.deepEqual(await files(fs), { xaa: "616263" });
});

test("aborted invocation never acquires input", async () => {
  const reason = { exact: true };
  const controller = new AbortController();
  controller.abort(reason);
  const input = (async function* () { throw new Error("not allowed"); yield Buffer.alloc(0); })();
  await assert.rejects(run([], input, {}, { signal: controller.signal }), error => error === reason);
});

test("blocked host write aborts promptly and late rejection is observed", async () => {
  const fs = createMemoryFileSystem();
  const controller = new AbortController();
  const reason = new Error("stop blocked writer");
  let rejectHost!: (error: unknown) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const backend = wrapped(fs, { writeStream(_path: string, _source: ByteSource, options?: WriteFileOptions) {
    assert.ok(options?.signal);
    entered();
    return new Promise<void>((_resolve, reject) => { rejectHost = reject; });
  } });
  const operation = run(["-b2"], "abc", {}, { fs: backend, signal: controller.signal });
  await started;
  controller.abort(reason);
  await assert.rejects(operation, error => error === reason);
  rejectHost(new Error("late host failure"));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(await files(fs), {});
});

test("cancelled write source refuses even its prefetched first chunk", async () => {
  const fs = createMemoryFileSystem();
  const controller = new AbortController();
  const reason = new Error("cancel before host begins pulling");
  let held: ByteSource | undefined;
  let entered!: () => void;
  let finish!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const backend = wrapped(fs, { writeStream(_path, source) {
    held = source;
    entered();
    return new Promise<void>(resolve => { finish = resolve; });
  } });
  const operation = run(["-b2"], "abc", {}, { fs: backend, signal: controller.signal });
  await started;
  controller.abort(reason);
  await assert.rejects(operation, error => error === reason);
  try { await assert.rejects(held![Symbol.asyncIterator]().next(), error => error === reason); }
  finally { finish(); }
  assert.deepEqual(await files(fs), {});
});

test("blocked iterator abort closes asynchronously without waiting forever", async () => {
  const controller = new AbortController();
  const reason = { stop: "input" };
  let waiting!: () => void;
  const started = new Promise<void>(resolve => { waiting = resolve; });
  let closed = false;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    next() { waiting(); return new Promise<IteratorResult<Uint8Array>>(() => {}); },
    async return() { closed = true; return { done: true, value: undefined }; },
  }; } };
  const operation = run([], source, {}, { signal: controller.signal });
  await started;
  controller.abort(reason);
  await assert.rejects(operation, error => error === reason);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, true);
});

test("CPU scanning yields for timer cancellation on a large line", async () => {
  const controller = new AbortController();
  const reason = new Error("timer abort");
  const fs = createMemoryFileSystem();
  const sink = wrapped(fs, { async writeStream(path, source, options) {
    await fs.writeFile(path, Buffer.alloc(0), options);
    for await (const chunk of source) await fs.appendFile(path, chunk, options);
  } });
  const operation = run(["-l1"], Buffer.alloc(8 * 1024 * 1024, 65), {}, { fs: sink, signal: controller.signal });
  const timer = setTimeout(() => controller.abort(reason), 0);
  try { await assert.rejects(operation, error => error === reason); } finally { clearTimeout(timer); }
  const entries = await files(fs);
  if (entries.xaa) assert.ok(entries.xaa.length < 16 * 1024 * 1024);
});
