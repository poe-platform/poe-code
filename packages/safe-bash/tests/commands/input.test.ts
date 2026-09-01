import assert from "node:assert/strict";
import test from "node:test";
import { createMountFileSystem, createReadOnlyFileSystem, FsError, MemoryFileSystem, type FileSystem, type ReadFileOptions } from "poe-code/safe-fs";
import { standardCommands } from "../../src/commands/index.js";
import { bufferLimit, input } from "../../src/commands/internal.js";
import { collectBytes, toByteSource, type CommandContext } from "../../src/contracts/index.js";
import { Shell, ShellLimitError } from "../../src/shell/index.js";

for (const streaming of [false, true]) {
  for (const size of [65_537, 65_538]) {
    test(`redirected input has an independent bound: streaming=${streaming}, size=${size}`, async () => {
      const fs: FileSystem = new MemoryFileSystem();
      if (!streaming) Object.defineProperty(fs, "readStream", { value: undefined });
      await fs.writeFile("/large", new Uint8Array(size));
      const shell = new Shell({ fs, limits: { maxInputBytes: 65_537, maxOutputBytes: 65_536 } }).use(standardCommands());
      try {
        const result = await shell.exec("wc -c < /large");
        if (size === 65_537) {
          assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(result.stdout.trim(), "65537");
          await assert.rejects(shell.exec("cat < /large"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
        } else {
          assert.notEqual(result.exitCode, 0);
          assert.match(result.stderr, /EFBIG|file too large/i);
        }
      } finally { await shell.dispose(); }
    });
  }

  test(`redirected input preserves cancellation: streaming=${streaming}`, async () => {
    const fs: FileSystem = new MemoryFileSystem();
    await fs.writeFile("/input", new Uint8Array([1]));
    const controller = new AbortController();
    const reason = new Error("cancel redirected read");
    let closed = false;
    if (streaming) {
      fs.readStream = () => (async function* () {
        try { controller.abort(reason); yield new Uint8Array([1]); }
        finally { closed = true; }
      })();
    } else {
      Object.defineProperty(fs, "readStream", { value: undefined });
      fs.readFile = async (_path, options) => {
        assert.equal(options?.maxBytes, 100);
        assert.ok(options?.signal);
        controller.abort(reason);
        return new Uint8Array([1]);
      };
    }
    const shell = new Shell({ fs, limits: { maxInputBytes: 100 } }).use(standardCommands());
    try {
      await assert.rejects(shell.exec("wc -c < /input", { signal: controller.signal }), error => error === reason);
      if (streaming) assert.equal(closed, true);
    } finally { await shell.dispose(); }
  });
}

test("redirected input rejects oversized adapter results and counts stream chunks cumulatively", async () => {
  for (const streaming of [false, true]) {
    const fs: FileSystem = new MemoryFileSystem();
    await fs.writeFile("/input", new Uint8Array([1]));
    let closed = false;
    if (streaming) {
      fs.readStream = () => (async function* () {
        try { yield new Uint8Array(3); yield new Uint8Array(3); }
        finally { closed = true; }
      })();
    } else {
      Object.defineProperty(fs, "readStream", { value: undefined });
      fs.readFile = async () => new Uint8Array(6);
    }
    const shell = new Shell({ fs, limits: { maxInputBytes: 5 } }).use(standardCommands());
    try {
      const result = await shell.exec("wc -c < /input");
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /EFBIG|file too large/i);
      if (streaming) assert.equal(closed, true);
    } finally { await shell.dispose(); }
  }
});

test("redirected input honors disabled streaming and execution-specific input limits", async () => {
  const fs = await bufferedBackend();
  fs.readStream = () => { throw new Error("disabled readStream"); };
  const shell = new Shell({ fs, limits: { maxInputBytes: 1 } }).use(standardCommands());
  try {
    const result = await shell.exec("wc -c < /note", { limits: { maxInputBytes: 9 } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.trim(), "9");
    assert.equal((await shell.exec("wc -c < /note")).exitCode, 1);
  } finally { await shell.dispose(); }
});

async function bufferedBackend(readOnly = false): Promise<FileSystem> {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/note", new TextEncoder().encode("buffered\n"));
  const backend = readOnly ? createReadOnlyFileSystem(memory) : memory;
  return {
    capabilities: { readOnly, streamingRead: false },
    readFile: backend.readFile.bind(backend),
    writeFile: backend.writeFile.bind(backend),
    appendFile: backend.appendFile.bind(backend),
    stat: backend.stat.bind(backend),
    lstat: backend.lstat.bind(backend),
    readdir: backend.readdir.bind(backend),
    mkdir: backend.mkdir.bind(backend),
    rm: backend.rm.bind(backend),
    rename: backend.rename.bind(backend),
    copyFile: backend.copyFile.bind(backend),
    realpath: backend.realpath.bind(backend),
    access: backend.access.bind(backend),
  };
}

function context(fs: FileSystem, signal = new AbortController().signal): CommandContext {
  return {
    command: "cat", args: [], cwd: "/", env: {}, fs, signal,
    stdin: toByteSource(""),
    stdout: { async write() { assert.fail("input must not write stdout"); } },
    stderr: { async write() { assert.fail("input must not write stderr"); } },
  };
}

test("Shell cat reads required-method-only catalog and persisted-memory mounts", async (suite) => {
  const inputs = await bufferedBackend(true);
  const memory = await bufferedBackend();
  const inputRead = suite.mock.method(inputs, "readFile");
  const memoryRead = suite.mock.method(memory, "readFile");
  const fs = createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/inputs": inputs, "/memory": memory } });
  assert.equal(inputs.readStream, undefined);
  assert.equal(memory.readStream, undefined);
  assert.equal(fs.capabilities.streamingRead, undefined);
  const shell = new Shell({ fs }).use(standardCommands());
  try {
    const result = await shell.exec("cat /inputs/note; printf 'persisted\\n' > /memory/note; cat /memory/note");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "buffered\npersisted\n");
    for (const read of [inputRead, memoryRead]) {
      assert.equal(read.mock.callCount(), 1);
      assert.equal(read.mock.calls[0]!.arguments[1]?.maxBytes, bufferLimit);
      assert.ok(read.mock.calls[0]!.arguments[1]?.signal instanceof AbortSignal);
    }
    const denied = await shell.exec("printf changed > /inputs/note");
    assert.equal(denied.exitCode, 1);
    assert.ok(denied.stderr.includes("/inputs/note: Read-only file system"));
    assert.equal(new TextDecoder().decode(await inputs.readFile("/note")), "buffered\n");
  } finally { await shell.dispose(); }
});

test("input honors streamingRead false even when a method exists", async (suite) => {
  const fs = await bufferedBackend();
  const stream = suite.mock.fn(() => { throw new Error("disabled stream called"); });
  fs.readStream = stream;
  const bytes = await collectBytes(input(context(fs), "/note"), { maxBytes: bufferLimit });
  assert.equal(new TextDecoder().decode(bytes), "buffered\n");
  assert.equal(stream.mock.callCount(), 0);
});

test("a mixed mount preserves genuine streaming and closes on early consumption", async (suite) => {
  const backend = await bufferedBackend();
  let pulls = 0;
  let closed = false;
  backend.readStream = async function* () {
    try {
      pulls++;
      yield Uint8Array.of(65);
      pulls++;
      yield Uint8Array.of(66);
    } finally { closed = true; }
  };
  const read = suite.mock.method(backend, "readFile");
  const fs = createMountFileSystem({
    root: new MemoryFileSystem(),
    mounts: { "/stream": { ...backend, capabilities: { streamingRead: true } }, "/buffer": await bufferedBackend() },
  });
  const shell = new Shell({ fs }).use(standardCommands());
  try {
    const result = await shell.exec("head -c 1 /stream/note");
    assert.equal(result.stdout, "A");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(pulls, 1);
    assert.equal(closed, true);
    assert.equal(read.mock.callCount(), 0);
  } finally { await shell.dispose(); }
});

for (const partial of [false, true]) {
  for (const code of ["ENOTSUP", "EIO", "EACCES"] as const) {
    test(`input ${code} ${partial ? "after bytes" : "before bytes"} only retries unsupported pre-data reads`, async (suite) => {
      const backend = await bufferedBackend();
      backend.readStream = async function* () {
        if (partial) yield Uint8Array.of(65);
        throw new FsError(code, { syscall: "readStream", path: "/note" });
      };
      const read = suite.mock.method(backend, "readFile");
      const fs = createMountFileSystem({ root: new MemoryFileSystem(), mounts: {
        "/data": { ...backend, capabilities: { streamingRead: true } },
      } });
      const shell = new Shell({ fs }).use(standardCommands());
      try {
        const result = await shell.exec("cat /data/note");
        const fallback = code === "ENOTSUP" && !partial;
        assert.equal(result.exitCode, fallback ? 0 : 1, result.stderr);
        assert.equal(result.stdout, fallback ? "buffered\n" : partial ? "A" : "");
        assert.equal(result.stderr, fallback ? "" : `cat: ${new FsError(code, { syscall: "readStream", path: "/data/note" }).message}\n`);
        assert.equal(read.mock.callCount(), fallback ? 1 : 0);
      } finally { await shell.dispose(); }
    });
  }
}

test("input does not mistake a code-shaped noncanonical error for unsupported streaming", async (suite) => {
  const backend = await bufferedBackend();
  const failure = Object.assign(new Error("unrelated"), { code: "ENOTSUP" });
  const fs = { ...backend, capabilities: {}, readStream() { throw failure; } };
  const read = suite.mock.method(fs, "readFile");
  await assert.rejects(collectBytes(input(context(fs), "/note"), { maxBytes: bufferLimit }), error => error === failure);
  assert.equal(read.mock.callCount(), 0);
});

for (const mounted of [false, true]) {
  for (const control of ["return", "throw"] as const) {
    test(`input never retries ${mounted ? "mounted" : "direct"} empty-chunk ${control} failures`, async (suite) => {
      const backend = await bufferedBackend();
      const failure = new FsError("ENOTSUP", { syscall: "readStream", path: "/note" });
      let closed = false;
      const streaming = { ...backend, capabilities: {}, async *readStream() {
        try { yield new Uint8Array(); }
        finally {
          closed = true;
          if (control === "return") await Promise.reject(failure);
        }
      } };
      const read = suite.mock.method(streaming, "readFile");
      const fs = mounted ? createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/data": streaming } }) : streaming;
      const source = input(context(fs), mounted ? "/data/note" : "/note")[Symbol.asyncIterator]();
      assert.deepEqual(await source.next(), { done: false, value: new Uint8Array() });
      await assert.rejects(control === "return" ? source.return!() : source.throw!(failure), error =>
        control === "throw" || !mounted ? error === failure : error instanceof FsError && error.code === "ENOTSUP");
      assert.equal(closed, true);
      assert.equal(read.mock.callCount(), 0);
    });
  }
}

test("input can still fall back on a producer ENOTSUP after an empty chunk", async (suite) => {
  const backend = await bufferedBackend();
  const fs = { ...backend, capabilities: {}, async *readStream() {
    yield new Uint8Array();
    throw new FsError("ENOTSUP");
  } };
  const read = suite.mock.method(fs, "readFile");
  const bytes = await collectBytes(input(context(fs), "/note"), { maxBytes: bufferLimit });
  assert.equal(new TextDecoder().decode(bytes), "buffered\n");
  assert.equal(read.mock.callCount(), 1);
});

test("buffered fallback preserves canonical read errors and the mounted path", async (suite) => {
  const backend = await bufferedBackend();
  const read = suite.mock.method(backend, "readFile", async (_path: string, options?: ReadFileOptions) => {
    assert.equal(options?.maxBytes, bufferLimit);
    throw new FsError("EFBIG", { syscall: "readFile", path: "/note" });
  });
  const fs = createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/data": backend } });
  await assert.rejects(collectBytes(input(context(fs), "/data/note"), { maxBytes: bufferLimit }), error =>
    error instanceof FsError && error.code === "EFBIG" && error.path === "/data/note" && error.syscall === "readFile");
  assert.equal(read.mock.callCount(), 1);
});

test("buffered input rejects an oversized result before yielding it", async (suite) => {
  const fs = await bufferedBackend();
  suite.mock.method(fs, "readFile", async () => new Uint8Array(bufferLimit + 1));
  await assert.rejects(input(context(fs), "/note")[Symbol.asyncIterator]().next(), { code: "EFBIG" });
});

test("Shell output limits still apply to buffered mounted input", async (suite) => {
  const backend = await bufferedBackend();
  const read = suite.mock.method(backend, "readFile");
  const fs = createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/data": backend } });
  const shell = new Shell({ fs, limits: { maxOutputBytes: 3 } }).use(standardCommands());
  try {
    await assert.rejects(shell.exec("cat /data/note"), ShellLimitError);
    assert.equal(read.mock.callCount(), 1);
  } finally { await shell.dispose(); }
});

test("pre-aborted input never starts a read", async (suite) => {
  const fs = await bufferedBackend();
  const read = suite.mock.method(fs, "readFile");
  const failure = new FsError("ENOTSUP");
  await assert.rejects(collectBytes(input(context(fs, AbortSignal.abort(failure)), "/note"), { maxBytes: bufferLimit }), error => error === failure);
  assert.equal(read.mock.callCount(), 0);
});

test("an ENOTSUP-shaped stream cancellation never starts fallback", async (suite) => {
  const backend = await bufferedBackend();
  const controller = new AbortController();
  const failure = new FsError("ENOTSUP");
  const fs = { ...backend, capabilities: {}, readStream() {
    controller.abort(failure);
    throw failure;
  } };
  const read = suite.mock.method(fs, "readFile");
  await assert.rejects(collectBytes(input(context(fs, controller.signal), "/note"), { maxBytes: bufferLimit }), error => error === failure);
  assert.equal(read.mock.callCount(), 0);
});

test("buffered mounted input cancels pending reads and observes late failures", async (suite) => {
  const backend = await bufferedBackend();
  const controller = new AbortController();
  const failure = new Error("cancel input");
  let start!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  let rejectRead: ((reason: unknown) => void) | undefined;
  suite.mock.method(backend, "readFile", async (_path: string, options?: ReadFileOptions) => {
    assert.equal(options?.signal, controller.signal);
    start();
    return new Promise<Uint8Array>((_resolve, reject) => { rejectRead = reject; });
  });
  const fs = createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/data": backend } });
  const reading = collectBytes(input(context(fs, controller.signal), "/data/note"), { maxBytes: bufferLimit });
  const rejected = assert.rejects(reading, error => error === failure);
  try {
    const first = await Promise.race([started.then(() => "started"), reading.then(() => "finished", () => "failed")]);
    assert.equal(first, "started");
    controller.abort(failure);
    await rejected;
  } finally {
    rejectRead?.(new Error("late read failure"));
    await rejected;
  }
});
