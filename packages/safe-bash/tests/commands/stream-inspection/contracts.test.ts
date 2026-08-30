import assert from "node:assert/strict";
import test from "node:test";
import { FsError, type ByteSource, type FileSystem } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createStreamInspectionCommands } from "../../../src/commands/stream-inspection/index.js";
import { deferred, fixture, runFixture, type Name } from "./helpers.js";

const names: readonly Name[] = ["tac", "expand", "fold", "strings"];
function proxyFs(base: FileSystem, methods: Partial<FileSystem>): FileSystem {
  return new Proxy(base, { get(target, key) {
    const owner = key in methods ? methods : target;
    const value = Reflect.get(owner, key);
    return typeof value === "function" ? value.bind(owner) : value;
  } });
}

for (const name of names) {
  test(`${name}: owns reused input chunks and retained sink buffers`, async () => {
    const chunk = Buffer.from("abcd");
    const stdin = (async function* () { yield chunk; chunk.fill(120); yield Buffer.from("efgh\n"); })();
    const retained: Uint8Array[] = [];
    const result = await runFixture(fixture("ownership", name, [], ""), {}, { stdin, stdout: { async write(bytes) { retained.push(bytes); } } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(Buffer.concat(retained).toString(), "abcdefgh\n");
    assert.equal(chunk.toString(), "xxxx");
  });

  test(`${name}: cancellation identity during pending reads and late rejection`, async () => {
    const started = deferred(), controller = new AbortController();
    const reason = new FsError("ENOENT", { message: "cancel pending read" });
    let rejectRead!: (reason: Error) => void, closed = false;
    const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
      next() { started.resolve(); return new Promise((_resolve, reject) => { rejectRead = reject; }); },
      async return() { closed = true; return { done: true, value: undefined }; },
    }; } };
    const running = runFixture(fixture("pending", name, [], ""), {}, { stdin, signal: controller.signal });
    const check = assert.rejects(running, error => error === reason);
    await started.promise; controller.abort(reason); await check;
    rejectRead(new Error("late host read rejection"));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(closed, true);
  });

  test(`${name}: awaits a blocked write and cancels without late rejection leakage`, async () => {
    const blocked = deferred(), controller = new AbortController();
    const reason = new FsError("EACCES", { message: "cancel pending write" });
    let rejectWrite!: (reason: Error) => void, reads = 0;
    const stdin = (async function* () { for (let index = 0; index < 3; index++) { reads++; yield Buffer.from("abcd\n"); } })();
    const running = runFixture(fixture("write", name, [], ""), {}, { stdin, signal: controller.signal, stdout: { write() {
      blocked.resolve(); return new Promise((_resolve, reject) => { rejectWrite = reject; });
    } } });
    const check = assert.rejects(running, error => error === reason);
    await blocked.promise;
    assert.equal(reads, name === "tac" ? 3 : 1);
    controller.abort(reason); await check;
    rejectWrite(new Error("late host sink rejection"));
    await new Promise<void>(resolve => setImmediate(resolve));
  });

  test(`${name}: empty producers yield to cancellation and finite step quotas`, async () => {
    const controller = new AbortController(), reason = new Error("stop empty producer");
    const empty = () => (async function* () { while (true) yield new Uint8Array(); })();
    const running = runFixture(fixture("empty", name, [], ""), {}, { stdin: empty(), signal: controller.signal });
    const check = assert.rejects(running, error => error === reason);
    const timer = setTimeout(() => controller.abort(reason), 10);
    try { await check; } finally { clearTimeout(timer); }
    const bounded = await runFixture(fixture("empty-quota", name, [], ""), { limits: { maxSteps: 12 } }, { stdin: empty() });
    assert.equal(bounded.exitCode, 1); assert.match(bounded.stderr, /step limit exceeded/u);
  });

  test(`${name}: missing/directory operands fail, later valid file still runs`, async () => {
    const fs = createMemoryFileSystem(); await fs.mkdir("/work/directory", { recursive: true });
    const result = await runFixture(fixture("operands", name, ["missing", "directory", "valid"], "", { valid: Buffer.from("abcd\n").toString("hex") }), {}, { fs });
    assert.equal(result.exitCode, 1); assert.equal(result.stdout, "abcd\n");
    assert.match(result.stderr, /ENOENT.*missing/u); assert.match(result.stderr, /EISDIR.*directory/u);
    assert.equal((await fs.readdir("/work")).length, 2);
  });

  test(`${name}: input/output/chunk quotas aggregate across operands`, async () => {
    const specimen = fixture("aggregate", name, ["first", "second"], "", { first: "616263640a", second: "656667680a" });
    for (const [label, limits] of [["input", { maxInputBytes: 9 }], ["output", { maxOutputBytes: 9 }], ["chunk", { maxChunkBytes: 4 }]] as const) {
      const result = await runFixture(specimen, { limits });
      assert.equal(result.exitCode, 1); assert.match(result.stderr, new RegExp(`${label} limit exceeded`));
      if (label !== "chunk") assert.ok(result.stdout.startsWith("abcd\n"));
    }
  });

  test(`${name}: argument and operand limits preflight before any file access`, async () => {
    let touched = false;
    const fs = proxyFs(createMemoryFileSystem(), { async stat() { touched = true; throw new Error("unexpected read"); } });
    for (const limits of [{ maxFiles: 1 }, { maxArgumentBytes: 1 }]) {
      const result = await runFixture(fixture("preflight", name, ["left", "right"], ""), { limits }, { fs });
      assert.equal(result.exitCode, 1); assert.match(result.stderr, /(?:file|argument) limit exceeded/u);
    }
    assert.equal(touched, false);
  });

  test(`${name}: invalid options and values are diagnosed before reading`, async () => {
    const invalid = name === "tac" ? [["-r"], ["-s"], ["--before=yes"]]
      : name === "expand" ? [["-t0"], ["-t", "4,3"], ["-t", "+4,8"], ["-t", "4\n8"], ["--tabs"]]
      : name === "fold" ? [["-w0"], ["-w", "NaN"], ["--width"], ["-q"]]
      : [["-n0"], ["-tq"], ["--radix"], ["-d"]];
    for (const args of invalid) {
      const result = await runFixture(fixture("invalid", name, args, "abcd\n"));
      assert.equal(result.exitCode, 1); assert.equal(result.stdout, ""); assert.ok(result.stderr.startsWith(`${name}: `));
    }
  });
}

test("record retention is bounded for reversal, folding and printable runs", async () => {
  for (const name of ["tac", "fold", "strings"] as const) {
    const result = await runFixture(fixture("record", name, [], "abcd"), { limits: { maxRecordBytes: 3 } });
    assert.equal(result.exitCode, 1); assert.match(result.stderr, /record limit exceeded/u);
  }
});

test("zero/noninteger/nonfinite limits rejected at construction", () => {
  for (const value of [0, -1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createStreamInspectionCommands({ limits: { maxSteps: value } }), RangeError);
  }
});

test("VFS fallback passes signal and bounded maxBytes; stream errors retain their path", async () => {
  const base = createMemoryFileSystem();
  let seenSignal: AbortSignal | undefined, maximum: number | undefined;
  const fs = proxyFs(base, {
    async readFile(path, options) { seenSignal = options?.signal; maximum = options?.maxBytes; return base.readFile(path, options); },
  });
  const noStream = new Proxy(fs, { get(target, key) { return key === "readStream" ? undefined : Reflect.get(target, key); } });
  const result = await runFixture(fixture("fallback", "tac", ["file"], "", { file: "616263640a" }), { limits: { maxChunkBytes: 8 } }, { fs: noStream });
  assert.equal(result.stdout, "abcd\n"); assert.equal(maximum, 8); assert.equal(seenSignal?.aborted, true);
});

test("owned VFS signal aborts on downstream failure without aborting caller", async () => {
  const base = createMemoryFileSystem(), caller = new AbortController();
  let seenSignal: AbortSignal | undefined, closed = false;
  const fs = proxyFs(base, { readStream(_path, options) {
    seenSignal = options?.signal;
    return (async function* () { try { yield Buffer.from("abcd\n"); yield Buffer.from("later\n"); } finally { closed = true; } })();
  } });
  const result = await runFixture(fixture("downstream", "fold", ["file"], "", { file: "616263640a" }), {}, {
    fs, signal: caller.signal, stdout: { async write() { throw new FsError("EPIPE", { message: "sink closed" }); } },
  });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /sink closed/u);
  assert.equal(seenSignal?.aborted, true); assert.equal(caller.signal.aborted, false); assert.equal(closed, true);
});

test("strings flags select raw scan, labels and radix without treating '-' as stdin operand", async () => {
  const specimen = fixture("labels", "strings", ["-af", "-n2", "-tx", "-", "data"], "LEAK", { data: "006162096364006566" });
  const result = await runFixture(specimen);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "data:       1 ab\tcd\ndata:       7 ef\n");
  const stdin = await runFixture(fixture("stdin-label", "strings", ["--print-file-name", "--radix=o", "--bytes=2"], "\0ab"));
  assert.equal(stdin.stdout, "{standard input}:       1 ab\n");
});

test("UTF8 locale does not decode or reject byte-preserving input", async () => {
  const bytes = Buffer.from([195, 169, 255, 128, 0, 10]);
  for (const name of ["tac", "expand", "fold"] as const) {
    const result = await runFixture(fixture("unicode-policy", name, [], bytes), {}, { env: { LC_ALL: "en_US.UTF-8" } }, 1);
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdoutHex, bytes.toString("hex"));
  }
});

test("pending VFS metadata and fallback reads cancel while late host work settles", async () => {
  for (const operation of ["stat", "readFile"] as const) {
    const base = createMemoryFileSystem(), started = deferred(), controller = new AbortController();
    const reason = new Error(`cancel ${operation}`);
    let rejectHost!: (error: Error) => void, signal: AbortSignal | undefined;
    const fs = proxyFs(base, operation === "stat" ? {
      stat(_path, options) { signal = options?.signal; started.resolve(); return new Promise((_resolve, reject) => { rejectHost = reject; }); },
    } : {
      readFile(_path, options) { signal = options?.signal; started.resolve(); return new Promise((_resolve, reject) => { rejectHost = reject; }); },
    });
    const fallback = new Proxy(fs, { get(target, key) { return key === "readStream" ? undefined : Reflect.get(target, key); } });
    const running = runFixture(fixture("blocked-vfs", "tac", ["file"], "", { file: "616263640a" }), {}, { fs: fallback, signal: controller.signal });
    const check = assert.rejects(running, error => error === reason);
    await started.promise; controller.abort(reason); await check;
    assert.equal(signal?.aborted, true);
    rejectHost(new Error("late VFS rejection"));
    await new Promise<void>(resolve => setImmediate(resolve));
  }
});

test("stream failure retains completed output, diagnostic path and later operand", async () => {
  const base = createMemoryFileSystem();
  const fs = proxyFs(base, { readStream(path, options) {
    if (!path.endsWith("/broken")) return base.readStream(path, options);
    return (async function* () { yield Buffer.from("first\n"); throw new FsError("EIO", { path, message: `read failed: ${path}` }); })();
  } });
  const result = await runFixture(fixture("read-error", "fold", ["broken", "valid"], "", { broken: "00", valid: "6c617465720a" }), {}, { fs });
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, "first\nlater\n"); assert.match(result.stderr, /read failed: \/work\/broken/u);
});

test("large binary records and transforms are stable across chunk boundaries", async () => {
  const payload = Buffer.concat([Buffer.alloc(17001, 255), Buffer.from("é\0Z")]);
  const examples = [
    { name: "tac", args: ["-s", "::"], input: Buffer.concat([payload, Buffer.from("::last::")]), expected: Buffer.concat([Buffer.from("last::"), payload, Buffer.from("::")]) },
    { name: "expand", args: ["-t4"], input: Buffer.from("a\t".repeat(12000)), expected: Buffer.from("a   ".repeat(12000)) },
    { name: "fold", args: ["-bw127"], input: Buffer.alloc(33021, 255), expected: Buffer.concat([...Array.from({ length: 260 }, () => Buffer.concat([Buffer.alloc(127, 255), Buffer.from("\n")])), Buffer.alloc(1, 255)]) },
    { name: "strings", args: [], input: Buffer.from("A".repeat(33001) + "\0"), expected: Buffer.from("A".repeat(33001) + "\n") },
  ] as const;
  for (const example of examples) {
    const specimen = fixture("large", example.name, example.args, example.input);
    for (const chunkSize of [1, 8191]) {
      const result = await runFixture(specimen, {}, {}, chunkSize);
      assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdoutHex, example.expected.toString("hex"));
    }
  }
});

test("CPU-heavy nonempty scans yield to caller cancellation", async () => {
  for (const name of names) {
    const controller = new AbortController(), reason = new Error("interrupt scan");
    const running = runFixture(fixture("scan", name, [], Buffer.alloc(200000, 65)), {}, { signal: controller.signal }, 200000);
    const check = assert.rejects(running, error => error === reason);
    const timer = setTimeout(() => controller.abort(reason), 0);
    try { await check; } finally { clearTimeout(timer); }
  }
});
