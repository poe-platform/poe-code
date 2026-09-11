import assert from "node:assert/strict";
import type { Stats } from "node:fs";
import { test } from "node:test";
import { Volume } from "memfs";
import { CommandRegistry, FsError, toByteSource, writeText } from "../../src/contracts/index.js";
import type { ByteSource, FileStat } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell, ShellLimitError } from "../../src/shell/index.js";

function fixture(contents = "abcdef\n") {
  const volume = Volume.fromJSON({ "/left": contents });
  const fs = new MemoryFileSystem();
  const metadata = (stat: Stats): FileStat => {
    return { type: stat.isDirectory() ? "directory" : "file", size: Number(stat.size), mode: Number(stat.mode),
      mtimeMs: Number(stat.mtimeMs), atimeMs: Number(stat.atimeMs), ctimeMs: Number(stat.ctimeMs), ino: Number(stat.ino), dev: Number(stat.dev) };
  };
  fs.access = async (path, mode) => { volume.accessSync(path, mode); };
  fs.stat = async path => metadata(volume.statSync(path));
  fs.readFile = async path => new Uint8Array(volume.readFileSync(path) as Buffer);
  fs.readStream = path => toByteSource(new Uint8Array(volume.readFileSync(path) as Buffer));
  fs.openReadFile = async path => {
    const descriptor = volume.openSync(path, "r");
    return {
      async stat(options) { options?.signal?.throwIfAborted(); return metadata(volume.fstatSync(descriptor)); },
      async read(position, maxBytes, options) {
        options?.signal?.throwIfAborted();
        const bytes = new Uint8Array(maxBytes);
        const length = volume.readSync(descriptor, bytes, 0, maxBytes, position);
        return bytes.subarray(0, length);
      },
      async close() { volume.closeSync(descriptor); },
    };
  };
  const commands = new CommandRegistry([
    { name: "cat", async execute(context) {
      for await (const chunk of context.stdin) await context.stdout.write(chunk);
      return { exitCode: 0 };
    } },
    { name: "take", async execute(context) {
      assert.ok(context.stdinInput, "shell must expose the shared input contract");
      const result = await context.stdinInput.read(Number(context.args[0]), context.signal);
      if (!result.done) await context.stdout.write(result.value);
      return { exitCode: 0 };
    } },
    { name: "inspect", async execute(context) {
      assert.ok(context.stdinInput);
      const input = context.stdinInput;
      await writeText(context.stdout, `${input.stat?.type ?? "stream"}:${input.stat?.size ?? "-"}:${input.position}:${typeof input.seek}\n`);
      return { exitCode: 0 };
    } },
    { name: "seek", async execute(context) {
      assert.ok(context.stdinInput?.seek);
      await context.stdinInput.seek(Number(context.args[0]), context.signal);
      return { exitCode: 0 };
    } },
  ]);
  return { volume, fs, commands, shell: new Shell({ fs, commands }) };
}

for (const script of ["{ take 1; cat; } <left", "cat <left | { take 1; cat; }"]) {
  test(`bounded command input preserves following cat: ${script}`, async () => {
    const { shell } = fixture();
    try {
      const result = await shell.exec(script);
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "abcdef\n", ""]);
    } finally { await shell.dispose(); }
  });
}

test("builtin reads and descriptor aliases share file metadata and byte position", async () => {
  const { shell } = fixture();
  try {
    const result = await shell.exec("{ read -n1 discarded; inspect; take 2 <&3; inspect; cat; } 3<left <&3");
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "file:7:1:function\nbcfile:7:3:function\ndef\n", ""]);
  } finally { await shell.dispose(); }
});

test("line and source reads advance by raw consumed bytes", async () => {
  const { shell } = fixture("a\\\nb\nrest\n");
  try {
    assert.equal((await shell.exec("{ read discarded; inspect; cat; } <left")).stdout, "file:10:5:function\nrest\n");
    assert.equal((await shell.exec("bash", { stdin: "inspect\ninspect\n" })).stdout, "stream:-:8:undefined\nstream:-:16:undefined\n");
  } finally { await shell.dispose(); }
});

test("file seeking works backward, forward, after EOF and past EOF without reopening", async () => {
  const { shell, fs } = fixture();
  const openReadFile = fs.openReadFile.bind(fs);
  let opens = 0;
  fs.openReadFile = (...args) => { opens++; return openReadFile(...args); };
  try {
    const result = await shell.exec("{ take 2; seek 4; take 1; seek 0; cat; seek 2; take 2; seek 20; inspect; cat; seek 6; cat; } <left");
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "abeabcdef\ncdfile:7:20:function\n\n", ""]);
    assert.equal(opens, 1);
  } finally { await shell.dispose(); }
});

test("transparent invoke inherits cursor but replacement input has no stale metadata", async () => {
  const { shell, commands } = fixture();
  commands.register({ name: "forward", async execute(context) {
    await context.invoke!("take", ["1"]);
    await context.invoke!("inspect", [], { stdin: context.stdin });
    await context.invoke!("inspect", [], { stdin: toByteSource("replacement") });
    await context.invoke!("inspect", []);
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec("{ forward; cat; } <left");
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "afile:7:1:function\nstream:-:0:undefined\nfile:7:1:function\nbcdef\n", ""]);
    assert.equal((await shell.exec("cat <left | inspect")).stdout, "stream:-:0:undefined\n");
  } finally { await shell.dispose(); }
});

test("bounded reads fill across producer chunks and retain producer-owned remainders", async () => {
  const { shell, commands } = fixture();
  const storage = Buffer.alloc(3);
  const source: ByteSource = { async *[Symbol.asyncIterator]() {
    try {
      storage.set([97, 98, 99]); yield storage;
      storage.set([100, 101, 102]); yield storage;
    } finally { storage.fill(120); }
  } };
  commands.register({ name: "check", async execute(context) {
    const input = context.stdinInput!;
    const first = await input.read(4, context.signal);
    assert.equal(input.position, 4);
    const second = await input.read(4, context.signal);
    assert.equal(input.position, 6);
    assert.deepEqual(first, { done: false, value: new TextEncoder().encode("abcd") });
    assert.deepEqual(second, { done: false, value: new TextEncoder().encode("ef") });
    assert.equal((await input.read(1, context.signal)).done, true);
    return { exitCode: 0 };
  } });
  try { assert.equal((await shell.exec("check", { stdin: source })).exitCode, 0); }
  finally { await shell.dispose(); }
});

test("sequential redirect retains its admitted stat without additional stat calls", async () => {
  const { shell, fs, commands } = fixture();
  Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities, retainedRead: false } });
  const stat = fs.stat.bind(fs);
  const admitted: FileStat[] = [];
  fs.stat = async (...args) => { const result = await stat(...args); admitted.push(result); return result; };
  commands.register({ name: "metadata", execute(context) {
    assert.ok(context.stdinInput?.stat);
    assert.ok(admitted.includes(context.stdinInput.stat));
    assert.equal(admitted.filter(value => value.type === "file").length, 1);
    return { exitCode: 0 };
  } });
  try { assert.equal((await shell.exec("metadata <left")).exitCode, 0); }
  finally { await shell.dispose(); }
});

for (const fallback of ["disabled", "unsupported"] as const) {
  test(`file metadata remains but seek is absent for ${fallback} retained reads`, async () => {
    const { shell, fs } = fixture();
    let opens = 0;
    fs.openReadFile = async () => { opens++; throw new FsError("ENOTSUP"); };
    if (fallback === "disabled") Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities, retainedRead: false } });
    try {
      const result = await shell.exec("{ take 1; inspect; cat; } <left");
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "afile:7:1:undefined\nbcdef\n", ""]);
      assert.equal(opens, fallback === "disabled" ? 0 : 1);
    } finally { await shell.dispose(); }
  });
}

test("retained seek keeps the opened inode after pathname replacement", async () => {
  const { shell, commands, volume } = fixture();
  commands.register({ name: "replace", execute() {
    volume.renameSync("/left", "/old");
    volume.writeFileSync("/left", "replacement");
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec("{ take 1; replace; seek 3; cat; seek 0; cat; } <left");
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "adef\nabcdef\n", ""]);
  } finally { await shell.dispose(); }
});

test("zero-length input reads do not pull and invalid sizes/positions do not change the cursor", async () => {
  const { shell, commands } = fixture();
  commands.register({ name: "bounds", async execute(context) {
    const input = context.stdinInput!;
    for (const value of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(input.read(value, context.signal), RangeError);
      await assert.rejects(input.seek!(value, context.signal), RangeError);
    }
    assert.deepEqual(await input.read(0, context.signal), { done: false, value: new Uint8Array() });
    assert.equal(input.position, 0);
    return { exitCode: 0 };
  } });
  try { assert.deepEqual((await shell.exec("{ bounds; cat; } <left")).stdout, "abcdef\n"); }
  finally { await shell.dispose(); }
});

for (const reason of [false, 0, "", null]) {
  test(`aborted handle acquisition awaits late acquisition and close (${JSON.stringify(reason)})`, { timeout: 2000 }, async () => {
    const { shell, fs } = fixture();
    const controller = new AbortController();
    let acquired!: () => void;
    const started = new Promise<void>(resolve => { acquired = resolve; });
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    let closeEntered!: () => void;
    const closing = new Promise<void>(resolve => { closeEntered = resolve; });
    let finishClose!: () => void;
    const closeWait = new Promise<void>(resolve => { finishClose = resolve; });
    let closes = 0;
    fs.openReadFile = async () => {
      acquired(); await wait;
      return { stat: () => fs.stat("/left"), async read() { throw new Error("read after cancellation"); },
        async close() { closes++; closeEntered(); await closeWait; } };
    };
    let settled = false;
    const execution = shell.exec("inspect <left", { signal: controller.signal }).finally(() => { settled = true; });
    const rejected = assert.rejects(execution, error => Object.is(error, reason));
    try {
      await started;
      controller.abort(reason);
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(settled, false);
      release(); await closing;
      assert.equal(settled, false);
      finishClose(); await rejected;
      assert.equal(closes, 1);
    } finally { release(); finishClose(); await rejected; await shell.dispose(); }
  });
}

test("stdout target follows descriptors and transparent invokes, not replacement sinks or pipes", async () => {
  const { shell, commands } = fixture();
  commands.register({ name: "target", async execute(context) {
    await writeText(context.stderr, `${context.stdoutFile?.path ?? "stream"}\n`);
    return { exitCode: 0 };
  } });
  commands.register({ name: "forward-output", async execute(context) {
    await context.invoke!("target", []);
    await context.invoke!("target", [], { stdout: context.stdout });
    await context.invoke!("target", [], { stdout: { async write() {} } });
    return context.invoke!("target", []);
  } });
  try {
    const result = await shell.exec("forward-output 3>/dev/null >&3; target | cat; target >&-; target 2>/dev/null >&2");
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "", "/dev/null\n/dev/null\nstream\n/dev/null\nstream\nstream\n"]);
  } finally { await shell.dispose(); }
});

test("empty-chunk producers yield to cancellation inside bounded read", { timeout: 2000 }, async () => {
  const { shell } = fixture();
  const controller = new AbortController();
  let pulls = 0;
  let returns = 0;
  const source: ByteSource = { [Symbol.asyncIterator]: () => ({
    async next() { pulls++; return { done: false, value: new Uint8Array() }; },
    async return() { returns++; return { done: true, value: undefined }; },
  }) };
  const reason = false;
  const execution = assert.rejects(shell.exec("take 1", { stdin: source, signal: controller.signal }), error => Object.is(error, reason));
  setImmediate(() => controller.abort(reason));
  try { await execution; assert.ok(pulls < 1024); assert.equal(returns, 1); }
  finally { controller.abort(reason); await execution; await shell.dispose(); }
});

test("huge valid read requests allocate only delivered bytes", async () => {
  const { shell } = fixture();
  try {
    const result = await shell.exec(`take ${Number.MAX_SAFE_INTEGER}`, { stdin: "small" });
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "small", ""]);
  } finally { await shell.dispose(); }
});

test("local read cancellation restores staged bytes without advancing logical position", async () => {
  const { shell, commands } = fixture();
  const controller = new AbortController();
  let release!: (result: IteratorResult<Uint8Array>) => void;
  const pending = new Promise<IteratorResult<Uint8Array>>(resolve => { release = resolve; });
  let pulls = 0;
  const source: ByteSource = { [Symbol.asyncIterator]: () => ({
    next() {
      if (++pulls === 1) return Promise.resolve({ done: false, value: new TextEncoder().encode("ab") });
      if (pulls === 2) { controller.abort(0); return pending; }
      return Promise.resolve({ done: true, value: undefined });
    },
  }) };
  commands.register({ name: "cancel-read", async execute(context) {
    const input = context.stdinInput!;
    await assert.rejects(input.read(4, controller.signal), error => error === 0);
    assert.equal(input.position, 0);
    release({ done: false, value: new TextEncoder().encode("cd") });
    const result = await input.read(4, context.signal);
    assert.equal(input.position, 4);
    assert.deepEqual(result, { done: false, value: new TextEncoder().encode("abcd") });
    return { exitCode: 0 };
  } });
  try { assert.equal((await shell.exec("cancel-read", { stdin: source, limits: { maxInputBytes: 4 } })).exitCode, 0); }
  finally { release({ done: true, value: undefined }); await shell.dispose(); }
});

test("invalid retained read payloads are not coerced into EOF", async () => {
  const { shell, fs } = fixture();
  fs.openReadFile = async () => ({
    stat: () => fs.stat("/left"),
    async read() { return undefined as unknown as Uint8Array; },
    async close() {},
  });
  try { assert.equal((await shell.exec("take 1 <left")).exitCode, 1); }
  finally { await shell.dispose(); }
});

test("pending locally cancelled handle reads settle before a shared seek", { timeout: 2000 }, async () => {
  const { shell, fs, commands } = fixture();
  const open = fs.openReadFile.bind(fs);
  const controller = new AbortController();
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  let reading!: () => void;
  const started = new Promise<void>(resolve => { reading = resolve; });
  fs.openReadFile = async (...args) => {
    const handle = await open(...args);
    let reads = 0;
    return { ...handle, async read(...args) {
      if (++reads === 1) { reading(); await wait; }
      return handle.read(...args);
    } };
  };
  commands.register({ name: "pending-seek", async execute(context) {
    const input = context.stdinInput!;
    const first = assert.rejects(input.read(2, controller.signal), error => error === false);
    await started; controller.abort(false); await first;
    assert.equal(input.position, 0);
    let sought = false;
    const seek = input.seek!(4, context.signal).then(() => { sought = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(sought, false);
    release(); await seek;
    assert.equal(input.position, 4);
    const result = await input.read(1, context.signal);
    assert.deepEqual(result, { done: false, value: new TextEncoder().encode("e") });
    return { exitCode: 0 };
  } });
  try { assert.equal((await shell.exec("pending-seek <left")).exitCode, 0); }
  finally { release(); await shell.dispose(); }
});

test("retained read cancellation waits for admitted read and final close", { timeout: 2000 }, async () => {
  const { shell, fs } = fixture();
  const controller = new AbortController();
  let reading!: () => void;
  const started = new Promise<void>(resolve => { reading = resolve; });
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  let closed = false;
  fs.openReadFile = async () => ({
    stat: () => fs.stat("/left"),
    async read() { reading(); await wait; assert.equal(closed, false); return new Uint8Array([97]); },
    async close() { closed = true; },
  });
  let settled = false;
  const execution = shell.exec("take 1 <left", { signal: controller.signal }).finally(() => { settled = true; });
  const rejected = assert.rejects(execution, error => error === 0);
  try {
    await started; controller.abort(0);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false); assert.equal(closed, false);
    release(); await rejected; assert.equal(closed, true);
  } finally { release(); await rejected; await shell.dispose(); }
});

for (const reason of [undefined, null, false, 0, "", NaN]) {
  test(`bounded reads preserve falsey producer rejection (${String(reason)})`, async () => {
    const { shell, commands } = fixture();
    const source: ByteSource = { [Symbol.asyncIterator]: () => ({ async next() { throw reason; } }) };
    commands.register({ name: "reject-read", async execute(context) {
      await assert.rejects(context.stdinInput!.read(1, context.signal), error => Object.is(error, reason));
      assert.equal(context.stdinInput!.position, 0);
      return { exitCode: 0 };
    } });
    try { assert.equal((await shell.exec("reject-read", { stdin: source })).exitCode, 0); }
    finally { await shell.dispose(); }
  });
}

test("bounded reads and seeking cannot evade input byte limits", async () => {
  const { shell } = fixture();
  try {
    const result = await shell.exec("take 3 <left", { limits: { maxInputBytes: 3 } });
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "abc", ""]);
    const tooMuch = await shell.exec("take 4 <left", { limits: { maxInputBytes: 3 } });
    assert.equal(tooMuch.exitCode, 1);
    const reread = await shell.exec("{ take 3; seek 0; take 1; } <left", { limits: { maxInputBytes: 3 } });
    assert.equal(reread.exitCode, 1);
    await assert.rejects(shell.exec("take 4", { stdin: "abcd", limits: { maxInputBytes: 3 } }), error => error instanceof Error && error.message.includes("maxInputBytes"));
  } finally { await shell.dispose(); }
});

test("bounded requests do not send new arguments into generic byte producers", async () => {
  const { shell } = fixture();
  let reads = 0;
  const source: ByteSource = { [Symbol.asyncIterator]: () => ({
    async next(...args: unknown[]) {
      assert.equal(args.length, 0);
      return reads++ ? { done: true, value: undefined } : { done: false, value: new TextEncoder().encode("abc") };
    },
  }) };
  try {
    const result = await shell.exec("take 1; cat", { stdin: source });
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "abc", ""]);
  } finally { await shell.dispose(); }
});

test("retained input metadata describes the opened handle across stat/open pathname replacements", async () => {
  const { shell, fs, volume, commands } = fixture("a");
  const open = fs.openReadFile.bind(fs);
  const stat = fs.stat.bind(fs);
  let pathnameStats = 0;
  let handleStats = 0;
  let bound: FileStat | undefined;
  fs.stat = async (...args) => { if (args[0] === "/left") pathnameStats++; return stat(...args); };
  fs.openReadFile = async (...args) => {
    volume.renameSync("/left", "/before");
    volume.writeFileSync("/left", "x".repeat(100));
    const handle = await open(...args);
    volume.renameSync("/left", "/opened");
    volume.writeFileSync("/left", "y".repeat(300));
    return { ...handle, async stat(options) { handleStats++; bound = await handle.stat(options); return bound; } };
  };
  commands.register({ name: "bound-stat", execute(context) {
    assert.ok(bound);
    assert.equal(context.stdinInput?.stat, bound);
    assert.equal(bound.size, 100);
    assert.equal(bound.ino, Number(volume.statSync("/opened").ino));
    assert.notEqual(bound.ino, Number(volume.statSync("/left").ino));
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec("{ bound-stat; inspect; take 1; seek 99; inspect; take 1; } <left");
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "file:100:0:function\nxfile:100:99:function\nx", ""]);
    assert.equal(pathnameStats, 1);
    assert.equal(handleStats, 1);
  } finally { await shell.dispose(); }
});

test("cancelled retained fstat waits for metadata work and close", { timeout: 2000 }, async () => {
  const { shell, fs } = fixture();
  const controller = new AbortController();
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  let closed = false;
  fs.openReadFile = async () => ({
    async stat() { entered(); await wait; assert.equal(closed, false); return fs.stat("/left"); },
    async read() { throw new Error("read after fstat cancellation"); },
    async close() { closed = true; },
  });
  let settled = false;
  const execution = shell.exec("inspect <left", { signal: controller.signal }).finally(() => { settled = true; });
  const rejected = assert.rejects(execution, error => error === false);
  try {
    await started; controller.abort(false);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false); assert.equal(closed, false);
    release(); await rejected; assert.equal(closed, true);
  } finally { release(); controller.abort(false); await rejected; await shell.dispose(); }
});

for (const reason of [undefined, null, false, 0, "", new FsError("ENOTSUP")]) {
  test(`retained fstat failure closes the handle without sequential retry (${String(reason)})`, async () => {
    const { shell, fs } = fixture();
    let closes = 0;
    let streams = 0;
    let buffered = 0;
    const errors: unknown[] = [];
    fs.readStream = () => { streams++; return toByteSource("wrong fallback"); };
    fs.readFile = async () => { buffered++; return new Uint8Array(); };
    fs.openReadFile = async () => ({
      async stat() { throw reason; },
      async read() { throw new Error("read after fstat failure"); },
      async close() { closes++; },
    });
    try {
      const result = await shell.exec("inspect <left", { onInternalError(error) { errors.push(error); } });
      assert.equal(result.exitCode, 1);
      assert.equal(closes, 1);
      assert.equal(streams, 0);
      assert.equal(buffered, 0);
      if (!(reason instanceof FsError)) assert.ok(errors.some(error => Object.is(error, reason)));
    } finally { await shell.dispose(); }
  });
}

test("seek eligibility follows the opened handle type rather than the earlier pathname type", async () => {
  const { shell, fs } = fixture();
  const open = fs.openReadFile.bind(fs);
  fs.openReadFile = async (...args) => {
    const handle = await open(...args);
    return { ...handle, async stat(options) { return { ...await handle.stat(options), type: "character" }; } };
  };
  try {
    const result = await shell.exec("{ inspect; take 1; } <left");
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "character:7:0:undefined\na", ""]);
  } finally { await shell.dispose(); }
});

for (const empty of [true, false]) {
  test(`bounded input enforces CPU checkpoints for an infinite ${empty ? "empty" : "nonempty"} producer`, async context => {
    let now = 0;
    context.mock.method(performance, "now", () => now);
    const { shell } = fixture();
    const controller = new AbortController();
    const watchdog = new Error("bounded input missed its CPU checkpoint");
    let pulls = 0;
    let returns = 0;
    const source: ByteSource = { [Symbol.asyncIterator]: () => ({
      async next() {
        now = 101;
        if (++pulls === 256) controller.abort(watchdog);
        return { done: false, value: empty ? new Uint8Array() : Uint8Array.of(97) };
      },
      async return() { returns++; return { done: true, value: undefined }; },
    }) };
    try {
      await assert.rejects(shell.exec(`take ${empty ? 1 : 1024}`, {
        stdin: source, signal: controller.signal, limits: { maxCpuMs: 100, maxWallClockMs: 500 },
      }), error => error instanceof ShellLimitError && error.limit === "maxCpuMs");
      assert.ok(pulls < 256);
      assert.equal(returns, 1);
    } finally { controller.abort(watchdog); await shell.dispose(); }
  });
}

test("bounded input assembly enforces CPU limits before publishing bytes or position", async context => {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  const { shell, commands } = fixture();
  const set = Uint8Array.prototype.set;
  let assembling = false;
  let completed = false;
  let position = -1;
  context.mock.method(Uint8Array.prototype, "set", function (this: Uint8Array, source: ArrayLike<number>, offset?: number) {
    if (assembling && this.byteLength === 256 && source.length === 1) now = 101;
    return set.call(this, source, offset);
  });
  commands.register({ name: "assemble", async execute(context) {
    assembling = true;
    try { await context.stdinInput!.read(256, context.signal); completed = true; }
    finally { position = context.stdinInput!.position; assembling = false; }
    return { exitCode: 0 };
  } });
  const source: ByteSource = { async *[Symbol.asyncIterator]() {
    for (let index = 0; index < 256; index++) yield Uint8Array.of(97);
  } };
  try {
    await assert.rejects(shell.exec("assemble", { stdin: source, limits: { maxCpuMs: 100, maxWallClockMs: 500 } }),
      error => error instanceof ShellLimitError && error.limit === "maxCpuMs");
    assert.equal(completed, false);
    assert.equal(position, 0);
  } finally { await shell.dispose(); }
});

test("repeated one-byte reads cannot bypass a cursor's cumulative input budget", async () => {
  const { shell, commands } = fixture();
  commands.register({ name: "four-reads", async execute(context) {
    for (let index = 0; index < 4; index++) {
      const result = await context.stdinInput!.read(1, context.signal);
      if (!result.done) await context.stdout.write(result.value);
    }
    return { exitCode: 0 };
  } });
  try {
    await assert.rejects(shell.exec("four-reads", { stdin: "abcd", limits: { maxInputBytes: 3 } }),
      error => error instanceof ShellLimitError && error.limit === "maxInputBytes");
  } finally { await shell.dispose(); }
});

test("opaque input chunks are admitted before an ownership copy", async context => {
  const { shell } = fixture();
  const slab = new Uint8Array(4096);
  let copies = 0;
  context.mock.method(globalThis, "Uint8Array", new Proxy(Uint8Array, {
    construct(target, args, newTarget) {
      if (args[0] === slab) copies++;
      return Reflect.construct(target, args, newTarget);
    },
  }));
  const source: ByteSource = { async *[Symbol.asyncIterator]() { yield slab; } };
  let failure: unknown;
  try {
    try { await shell.exec("take 1", { stdin: source, limits: { maxInputBytes: 3 } }); }
    catch (error) { failure = error; }
    assert.equal(copies, 0, "oversized producer slabs must be rejected before copying");
    assert.ok(failure instanceof ShellLimitError && failure.limit === "maxInputBytes");
  } finally { await shell.dispose(); }
});

test("read, next and transparent invoke share cumulative producer admission", async () => {
  const { shell, commands } = fixture();
  const written: number[] = [];
  let position = () => -1;
  commands.register({ name: "mixed-reads", async execute(context) {
    const input = context.stdinInput!;
    position = () => input.position;
    const first = await input.read(1, context.signal);
    if (!first.done) await context.stdout.write(first.value);
    const second = await context.stdin[Symbol.asyncIterator]().next();
    if (!second.done) await context.stdout.write(second.value);
    await context.invoke!("take", ["1"], { stdin: context.stdin });
    const fourth = await input.read(1, context.signal);
    if (!fourth.done) await context.stdout.write(fourth.value);
    return { exitCode: 0 };
  } });
  const source: ByteSource = { async *[Symbol.asyncIterator]() {
    for (const byte of [97, 98, 99, 100]) yield Uint8Array.of(byte);
  } };
  try {
    await assert.rejects(shell.exec("mixed-reads", {
      stdin: source, stdout: { async write(bytes) { written.push(...bytes); } }, limits: { maxInputBytes: 3 },
    }), error => error instanceof ShellLimitError && error.limit === "maxInputBytes");
    assert.deepEqual(written, [97, 98, 99]);
    assert.equal(position(), 3);
  } finally { await shell.dispose(); }
});

test("retained remainders are not charged again by next or invoke", async () => {
  const { shell, commands } = fixture();
  commands.register({ name: "borrow", async execute(context) {
    await context.invoke!("take", ["1"]);
    return context.invoke!("cat", [], { stdin: context.stdin });
  } });
  try {
    const result = await shell.exec("take 1; borrow", { stdin: "abc", limits: { maxInputBytes: 3 } });
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "abc", ""]);
  } finally { await shell.dispose(); }
});

test("iterator-only commands retain their own input-limit policy", async () => {
  const { shell } = fixture();
  try {
    for (let index = 0; index < 2; index++) {
      const result = await shell.exec("cat", { stdin: "abcd", limits: { maxInputBytes: 1 } });
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "abcd", ""]);
    }
  } finally { await shell.dispose(); }
});

test("bounded activation checks bytes already produced for an earlier iterator", async () => {
  const { shell, commands } = fixture();
  let priorReadCompleted = false;
  commands.register({ name: "activate-after-iterator", async execute(context) {
    const result = await context.stdin[Symbol.asyncIterator]().next();
    assert.deepEqual(result, { done: false, value: new TextEncoder().encode("abcd") });
    priorReadCompleted = true;
    assert.equal(context.stdinInput!.position, 4);
    await context.stdinInput!.read(0, context.signal);
    return { exitCode: 0 };
  } });
  try {
    await assert.rejects(shell.exec("activate-after-iterator", { stdin: "abcd", limits: { maxInputBytes: 3 } }),
      error => error instanceof ShellLimitError && error.limit === "maxInputBytes");
    assert.equal(priorReadCompleted, true);
  } finally { await shell.dispose(); }
});

test("bounded activation transfers prior producer accounting to subsequent iterator aliases", async () => {
  const { shell, commands } = fixture();
  const written: number[] = [];
  commands.register({ name: "activate-between-iterators", async execute(context) {
    await context.invoke!("take-iterator", []);
    const result = await context.stdinInput!.read(1, context.signal);
    if (!result.done) await context.stdout.write(result.value);
    await context.invoke!("take-iterator", [], { stdin: context.stdin });
    return context.invoke!("take-iterator", [], { stdin: context.stdin });
  } });
  commands.register({ name: "take-iterator", async execute(context) {
    const result = await context.stdin[Symbol.asyncIterator]().next();
    if (!result.done) await context.stdout.write(result.value);
    return { exitCode: 0 };
  } });
  const source: ByteSource = { async *[Symbol.asyncIterator]() {
    for (const byte of [97, 98, 99, 100]) yield Uint8Array.of(byte);
  } };
  try {
    await assert.rejects(shell.exec("activate-between-iterators", {
      stdin: source, stdout: { async write(bytes) { written.push(...bytes); } }, limits: { maxInputBytes: 3 },
    }), error => error instanceof ShellLimitError && error.limit === "maxInputBytes");
    assert.deepEqual(written, [97, 98, 99]);
  } finally { await shell.dispose(); }
});

test("zero-byte bounded reads activate shared admission but invalid requests do not", async () => {
  const { shell, commands } = fixture();
  commands.register({ name: "invalid-read", async execute(context) {
    await assert.rejects(context.stdinInput!.read(-1, context.signal), RangeError);
    return context.invoke!("cat", []);
  } });
  try {
    const legacy = await shell.exec("invalid-read", { stdin: "abcd", limits: { maxInputBytes: 1 } });
    assert.deepEqual([legacy.exitCode, legacy.stdout, legacy.stderr], [0, "abcd", ""]);
    await assert.rejects(shell.exec("take 0; cat", { stdin: "abcd", limits: { maxInputBytes: 3 } }),
      error => error instanceof ShellLimitError && error.limit === "maxInputBytes");
  } finally { await shell.dispose(); }
});
