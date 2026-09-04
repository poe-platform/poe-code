import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, FsError, toByteSource } from "../../../src/contracts/index.js";
import { createCmpCommand, createCmpCommands, cmpCommands } from "../../../src/commands/cmp/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { run } from "./helpers.js";

test("opt-in definitions, plugin collision policy, and actual Shell invocation", async () => {
  assert.equal(createCmpCommand().name, "cmp");
  assert.deepEqual(createCmpCommands().map(command => command.name), ["cmp"]);
  const commands = new CommandRegistry(createCmpCommands());
  assert.throws(() => cmpCommands().setup({ commands } as never), /already registered/);
  cmpCommands({ replace: true }).setup({ commands } as never);
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", Buffer.from("a\nb"));
  await fs.writeFile("/right", Buffer.from("a\nc"));
  const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(cmpCommands());
  try {
    const result = await shell.exec("cmp /left /right");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "/left /right differ: char 3, line 2\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("binary bytes, first difference, character display, and verbose alignment", async () => {
  assert.deepEqual(await run(["left", "right"]), { exitCode: 0, stdout: "", stderr: "" });
  const left = Buffer.from([0, 10, 127, 255]), right = Buffer.from([0, 10, 128, 254]);
  assert.deepEqual(await run(["-b", "left", "right"], left, right), {
    exitCode: 1, stdout: "left right differ: byte 3, line 2 is 177 ^? 200 M-^@\n", stderr: "",
  });
  assert.deepEqual(await run(["-bl", "left", "right"], left, right), {
    exitCode: 1, stdout: "3 177 ^?   200 M-^@\n4 377 M-^? 376 M-~\n", stderr: "",
  });
});

for (const [left, suffix] of [["", "which is empty"], ["a", "after byte 1, in line 1"], ["a\n", "after byte 2, line 1"], ["a\nb", "after byte 3, in line 2"]]) {
  test(`EOF: ${JSON.stringify(left)}`, async () => {
    assert.deepEqual(await run(["left", "right"], Buffer.from(left!), Buffer.from(`${left}x`)), {
      exitCode: 1, stdout: "", stderr: `cmp: EOF on 'left' ${suffix}\n`,
    });
  });
}

test("stdin omitted, stdin first, and duplicate stdin does not acquire input", async () => {
  assert.equal((await run(["left"])).exitCode, 0);
  assert.equal((await run(["-", "left"])).exitCode, 0);
  for (const args of [["-", "-"], ["-", "-", "0", "2"], ["-i", "1Y:2", "-", "-"]]) {
    assert.equal((await run(args, undefined, undefined, {
      stdin: { [Symbol.asyncIterator]() { throw new Error("must not consume duplicate stdin"); } },
    })).exitCode, 0);
  }
});

test("skip maxima, limit minima, positional skips, base and suffix support", async () => {
  const left = Buffer.from("00same"), right = Buffer.from("1same");
  for (const args of [["-i2:1", "left", "right"], ["left", "right", "0x2", "01"], ["-i2:1", "-i0:0", "left", "right", "1", "0"]]) {
    assert.equal((await run(args, left, right)).exitCode, 0);
  }
  assert.equal((await run(["-n0", "-n1", "left", "right"], left, right)).exitCode, 0);
  for (const value of ["1K", "1kB", "KiB", "1kD", "1Y", "18446744073709551616"]) {
    assert.equal((await run(["-i", value, "left", "right"], left, right)).exitCode, 0);
  }
});

test("silent suppresses open errors, but not read errors or usage errors", async () => {
  assert.deepEqual(await run(["-s", "missing", "right"]), { exitCode: 2, stdout: "", stderr: "" });
  assert.equal((await run(["-s", "-l", "left", "right"])).stderr,
    "cmp: options -l and -s are incompatible\ncmp: Try 'cmp --help' for more information.\n");
  const fs = createMemoryFileSystem();
  await fs.mkdir("/directory");
  assert.deepEqual(await run(["-s", "directory", "-"], undefined, undefined, { fs }), {
    exitCode: 2, stdout: "", stderr: "cmp: directory: Is a directory\n",
  });
});

test("zero limit still opens files; same missing path still fails", async () => {
  for (const args of [["-n0", "missing", "right"], ["missing", "missing"]]) {
    assert.deepEqual(await run(args), { exitCode: 2, stdout: "", stderr: "cmp: missing: No such file or directory\n" });
  }
});

test("reused Buffer chunks, unequal boundaries, and retained suffixes", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", Buffer.from("00abcdef"));
  await fs.writeFile("/right", Buffer.from("xabcdef"));
  fs.readStream = async function* (path, options) {
    const buffer = Buffer.alloc(4);
    const value = (path === "/left" ? "00abcdef" : "xabcdef").slice(options?.start ?? 0);
    const size = path === "/left" ? 4 : 2;
    const chunks = Array.from({ length: Math.ceil(value.length / size) }, (_, index) => value.slice(index * size, (index + 1) * size));
    try { for (const chunk of chunks) { buffer.fill(0); buffer.write(chunk); yield buffer.subarray(0, chunk.length); } }
    finally { buffer.fill(255); }
  };
  assert.deepEqual(await run(["-i2:1", "left", "right"], undefined, undefined, { fs }), { exitCode: 0, stdout: "", stderr: "" });
});

test("cancellation preserves falsey and errno-shaped reasons", async () => {
  for (const reason of [null, 0, new FsError("ENOENT")]) {
    const controller = new AbortController();
    const stdin = (async function* () { controller.abort(reason); yield Buffer.from("abc"); })();
    await assert.rejects(run(["left", "-"], undefined, undefined, { signal: controller.signal, stdin }), error => error === reason);
  }
});

test("early difference bounds reads and closes both generators", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", Buffer.from("a"));
  await fs.writeFile("/right", Buffer.from("b"));
  let reads = 0, closes = 0;
  fs.readStream = path => (async function* () {
    try { while (true) { reads++; if (reads > 2) throw new Error("read beyond first differing block"); yield Buffer.alloc(65536, path === "/left" ? 97 : 98); } }
    finally { closes++; }
  })();
  assert.equal((await run(["left", "right"], undefined, undefined, { fs })).exitCode, 1);
  assert.equal(reads, 2);
  assert.equal(closes, 2);
});

test("stream limits reject oversized chunks and bound readFile fallback", async () => {
  const stdin = toByteSource(new Uint8Array(17));
  const result = await run(["left", "-"], undefined, undefined, { stdin }, { limits: { maxChunkBytes: 16 } });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /chunk.*limit/);
});

test("regular files seek positional skips and huge skips do not read input", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", Buffer.from("00abc"));
  await fs.writeFile("/right", Buffer.from("xabc"));
  const readStream = fs.readStream.bind(fs);
  const starts: number[] = [];
  fs.readStream = (path, options) => {
    starts.push(options?.start ?? 0);
    return readStream(path, options);
  };
  assert.equal((await run(["left", "right", "2", "1"], undefined, undefined, { fs })).exitCode, 0);
  assert.deepEqual(starts, [2, 1]);
  fs.readStream = () => { throw new Error("overflowed regular-file skip must not read"); };
  assert.equal((await run(["-i1Y", "left", "right"], undefined, undefined, { fs })).exitCode, 0);
});

test("fallback passes maxBytes and signal, refuses unknown or excessive sizes", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", Buffer.from("abc"));
  const readFile = fs.readFile.bind(fs);
  const reads: unknown[] = [];
  Object.defineProperty(fs, "readStream", { value: undefined });
  fs.readFile = (path, options) => { reads.push(options); return readFile(path, options); };
  assert.equal((await run(["left", "-"], undefined, Buffer.from("abc"), { fs }, { limits: { maxFallbackBytes: 3 } })).exitCode, 0);
  assert.equal((reads[0] as { maxBytes: number }).maxBytes, 3);
  assert.ok((reads[0] as { signal: AbortSignal }).signal instanceof AbortSignal);
  reads.length = 0;
  assert.equal((await run(["left", "-"], undefined, undefined, { fs }, { limits: { maxFallbackBytes: 2 } })).exitCode, 2);
  assert.equal(reads.length, 0);
});

test("alias identity shortcuts occur after open checks", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", Buffer.from("a"));
  await fs.link("/left", "/alias");
  fs.readStream = () => { throw new Error("same identity should not read"); };
  assert.equal((await run(["left", "alias"], undefined, undefined, { fs })).exitCode, 0);
});

test("registered cleanup closes admission and waits for cooperative iterator return", async () => {
  let cleanup: (() => Promise<void>) | undefined;
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const returned = new Promise<void>(resolve => { release = resolve; });
  let returns = 0;
  const stdin = { [Symbol.asyncIterator]() {
    return {
      next() { entered(); return new Promise<IteratorResult<Uint8Array>>(() => {}); },
      async return() { returns++; await returned; return { value: undefined, done: true as const }; },
    };
  } };
  const operation = run(["left", "-"], undefined, undefined, { stdin, registerCleanup(callback) { cleanup = async () => { await callback(); }; } });
  const rejection = assert.rejects(operation, /closed/);
  await ready;
  assert.ok(cleanup);
  let settled = false;
  const closing = cleanup().then(() => { settled = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(returns, 1);
  release();
  await closing;
  await rejection;
  await cleanup();
  assert.equal(returns, 1);
});

test("producer finalizers cannot corrupt a retained peer chunk", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", Buffer.from("abc"));
  const buffer = Buffer.from("abc");
  fs.readStream = () => (async function* () { try { yield buffer; } finally { buffer.fill(0); } })();
  const stdin = (async function* () { yield Buffer.from("a"); buffer.fill(0); yield Buffer.from("bc"); })();
  assert.equal((await run(["left", "-"], undefined, undefined, { fs, stdin })).exitCode, 0);
});

test("empty chunks and skipped input yield to timer cancellation", async () => {
  for (const empty of [true, false]) {
    const controller = new AbortController();
    const reason = new Error("scheduled cancellation");
    const stdin = (async function* () {
      for (let index = 0; index < 10000; index++) yield empty ? new Uint8Array() : new Uint8Array(1024);
      throw new Error("starved scheduled cancellation");
    })();
    const scheduled = setImmediate(() => controller.abort(reason));
    try {
      await assert.rejects(run(["-i0:1G", "left", "-"], undefined, undefined, { stdin, signal: controller.signal }), error => error === reason);
    } finally { clearImmediate(scheduled); }
  }
});

test("abort interrupts pending VFS metadata without consuming input", async () => {
  const fs = createMemoryFileSystem();
  const controller = new AbortController();
  const reason = new Error("metadata cancellation");
  let release!: (error: Error) => void;
  fs.stat = async () => {
    controller.abort(reason);
    return new Promise((_, reject) => { release = reject; });
  };
  const operation = run(["left", "-"], undefined, undefined, { fs, signal: controller.signal });
  let timedOut = false;
  const fallback = setTimeout(() => { timedOut = true; release(new Error("metadata remained pending")); }, 30);
  try { await assert.rejects(operation, error => error === reason); assert.equal(timedOut, false); }
  finally { clearTimeout(fallback); release(new Error("late metadata rejection")); }
});

test("output backpressure blocks further reads and preserves abort reasons", async () => {
  const controller = new AbortController();
  const reason = new Error("output cancellation");
  let writes = 0;
  await assert.rejects(run(["left", "right"], Buffer.from("a"), Buffer.from("b"), {
    signal: controller.signal,
    stdout: { async write() { writes++; controller.abort(reason); return new Promise(() => {}); } },
  }), error => error === reason);
  assert.equal(writes, 1);
});

test("large skipped chunks yield without scanning a gigabyte first", async () => {
  const controller = new AbortController();
  const reason = new Error("large skip cancellation");
  const stdin = (async function* () {
    const chunk = new Uint8Array(1048576);
    for (let index = 0; index < 4; index++) yield chunk;
    throw new Error("skip starved cancellation");
  })();
  const scheduled = setImmediate(() => controller.abort(reason));
  try { await assert.rejects(run(["-i0:1G", "left", "-"], undefined, undefined, { stdin, signal: controller.signal }), error => error === reason); }
  finally { clearImmediate(scheduled); }
});

test("typed VFS errors retain operand, exit status and native C diagnostic", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", Buffer.from("abc"));
  for (const [code, message] of [["EIO", "Input/output error"], ["EBADF", "Bad file descriptor"], ["EACCES", "Permission denied"]] as const) {
    fs.readStream = () => ({ [Symbol.asyncIterator]() { throw new FsError(code); } });
    assert.deepEqual(await run(["-s", "left", "-"], undefined, undefined, { fs }), {
      exitCode: 2, stdout: "", stderr: `cmp: left: ${message}\n`,
    });
  }
});

test("cleanup failures become trouble after success and never mask a primary failure", async () => {
  for (const failOutput of [false, true]) {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/left", Buffer.from("a"));
    await fs.writeFile("/right", Buffer.from("b"));
    let returns = 0;
    fs.readStream = path => ({ [Symbol.asyncIterator]() {
      return {
        async next() { return { value: Buffer.alloc(65536, path === "/left" ? 97 : 98), done: false }; },
        async return() { returns++; throw new Error(`cleanup ${path}`); },
      };
    } });
    const result = await run(["left", "right"], undefined, undefined, {
      fs, ...(failOutput ? { stdout: { async write() { throw new Error("primary write failure"); } } } : {}),
    });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr, failOutput ? "cmp: primary write failure\n" : "cmp: left: cleanup /left\n");
    assert.equal(returns, 2);
  }
});

test("errno-shaped and falsey cancellation outrank a rejected cleanup", async () => {
  for (const reason of [null, 0, new FsError("ENOENT")]) {
    const controller = new AbortController();
    const stdin = { [Symbol.asyncIterator]() {
      return {
        async next() { controller.abort(reason); return { value: Buffer.from("a"), done: false }; },
        async return() { throw new Error("cleanup must not replace cancellation"); },
      };
    } };
    await assert.rejects(run(["left", "-"], undefined, undefined, { stdin, signal: controller.signal }), error => error === reason);
  }
});
