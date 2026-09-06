import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { CommandRegistry, type FileSystem, type FileReadHandle, type ByteSource } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell, ShellLimitError } from "../../src/shell/index.js";
import { resolveLimits } from "../../src/shell/runtime.js";
import { cloudflareWorkerLimits } from "../../src/shell/worker-limits.js";
import { MockS3Client, S3FileSystem, ReadOnlyFileSystem } from "poe-code/safe-fs";
import { scopeFileSystem } from "poe-code/safe-fs";

const encoder = new TextEncoder();
const operationLimit = (error: unknown): boolean => error instanceof ShellLimitError && error.limit === "maxFileSystemOperations";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(context: TestContext, maximum: number, filesystem: FileSystem = new MemoryFileSystem()) {
  const commands = new CommandRegistry([
    { name: "probe", async execute({ fs, signal }) { await fs.stat("/", { signal }); return { exitCode: 0 }; } },
    { name: "invoke", async execute(context) { return context.invoke!("probe", []); } },
  ]);
  const shell = new Shell({ fs: filesystem, commands, limits: { maxFileSystemOperations: maximum } });
  context.after(() => shell.dispose());
  return { shell, commands, fs: filesystem };
}

test("filesystem operation profiles and nonnegative safe-integer validation", () => {
  assert.equal(Reflect.get(resolveLimits(), "maxFileSystemOperations"), 100_000);
  assert.equal(Reflect.get(cloudflareWorkerLimits, "maxFileSystemOperations"), 10_000);
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => resolveLimits({ maxFileSystemOperations: value }), RangeError);
  }
  assert.equal(Reflect.get(resolveLimits({ maxFileSystemOperations: 0 }), "maxFileSystemOperations"), 0);
});

test("zero rejects metadata before dispatch but permits filesystem-free commands", async context => {
  const { shell, fs } = fixture(context, 0);
  const stat = context.mock.method(fs, "stat");
  assert.equal((await shell.exec(":")).exitCode, 0);
  await assert.rejects(shell.exec("probe"), operationLimit);
  assert.equal(stat.mock.callCount(), 0);
});

for (const source of [
  "probe; probe", "probe | probe", "probe; : $(probe)", "probe; (probe)",
  "probe; invoke", "probe; eval probe", "function nested { probe; }; probe; nested",
]) {
  test(`filesystem operations share admission across ${source}`, async context => {
    const { shell, fs } = fixture(context, 1);
    const stat = context.mock.method(fs, "stat");
    await assert.rejects(shell.exec(source), operationLimit);
    assert.equal(stat.mock.callCount(), 1);
  });
}

test("source and nested sh share the same operation counter", async context => {
  const { shell, fs } = fixture(context, 4);
  await fs.writeFile("/script", encoder.encode("probe; probe"));
  for (const source of ["source /script", "sh /script"]) {
    const stat = context.mock.method(fs, "stat");
    await assert.rejects(shell.exec(source), operationLimit);
    assert.equal(stat.mock.callCount(), 2);
    stat.mock.restore();
  }
});

test("each exec resets admission without resetting borrowed filesystem contents", async context => {
  const { shell, commands, fs } = fixture(context, 1);
  commands.register({ name: "persist", async execute({ fs }) {
    await fs.appendFile("/saved", encoder.encode("x"));
    return { exitCode: 0 };
  } });
  assert.equal((await shell.exec("persist")).exitCode, 0);
  assert.equal((await shell.exec("persist")).exitCode, 0);
  assert.equal(new TextDecoder().decode(await fs.readFile("/saved")), "xx");
  const replacement = new MemoryFileSystem();
  assert.equal((await shell.exec("persist", { fs: replacement })).exitCode, 0);
  assert.equal(new TextDecoder().decode(await replacement.readFile("/saved")), "x");
  assert.equal(new TextDecoder().decode(await fs.readFile("/saved")), "xx");
});

test("provider internal calls do not consume separate admissions", async context => {
  const memory = new MemoryFileSystem();
  const filesystem = Object.create(memory) as FileSystem;
  filesystem.stat = async function(path, options) { assert.equal(this, filesystem); return memory.stat(path, options); };
  filesystem.readFile = async function(path, options) {
    assert.equal(this, filesystem);
    await this.stat(path, options);
    return encoder.encode("host storage");
  };
  const { shell, commands } = fixture(context, 1, filesystem);
  commands.register({ name: "host", async execute({ fs }) {
    assert.equal(new TextDecoder().decode(await fs.readFile("/")), "host storage");
    return { exitCode: 0 };
  } });
  assert.equal((await shell.exec("host")).exitCode, 0);
});

test("failed operations consume admission even when the command catches their errors", async context => {
  const { shell, commands, fs } = fixture(context, 1);
  const reason = false;
  const stat = context.mock.method(fs, "stat", async () => { throw reason; });
  commands.register({ name: "caught", async execute({ fs }) {
    await assert.rejects(fs.stat("/missing"), error => error === reason);
    await fs.stat("/");
    return { exitCode: 0 };
  } });
  await assert.rejects(shell.exec("caught"), operationLimit);
  assert.equal(stat.mock.callCount(), 1);
});

test("exhausted admission cannot be swallowed to resume filesystem work", async context => {
  const { shell, commands, fs } = fixture(context, 0);
  const stat = context.mock.method(fs, "stat");
  commands.register({ name: "catchall", async execute({ fs }) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await fs.stat("/"); } catch { }
    }
    return { exitCode: 0 };
  } });
  await assert.rejects(shell.exec("catchall"), operationLimit);
  assert.equal(stat.mock.callCount(), 0);
});

test("read and write streams charge once rather than charging delivered chunks", async context => {
  const { shell, commands, fs } = fixture(context, 2);
  await fs.writeFile("/input", encoder.encode("abcd"));
  commands.register({ name: "stream", async execute({ fs, signal }) {
    await fs.writeStream!("/output", fs.readStream!("/input", { chunkSize: 1, signal }), { signal });
    return { exitCode: 0 };
  } });
  assert.equal((await shell.exec("stream")).exitCode, 0);
  assert.equal(new TextDecoder().decode(await fs.readFile("/output")), "abcd");
  await assert.rejects(shell.exec("stream", { limits: { maxFileSystemOperations: 1 } }), operationLimit);
});

test("handle stat and read are metered, close drains after exhaustion", async context => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/input", encoder.encode("abc"));
  const filesystem = Object.create(memory) as FileSystem;
  const { shell, commands } = fixture(context, 3, filesystem);
  const opened: FileReadHandle[] = [];
  let closes = 0;
  filesystem.openReadFile = async (...args) => {
    const handle = await memory.openReadFile(...args);
    opened.push(handle);
    return { stat: handle.stat.bind(handle), read: handle.read.bind(handle), async close() { closes++; await handle.close(); } };
  };
  commands.register({ name: "handle", async execute({ fs, registerCleanup }) {
    const handle = await fs.openReadFile!("/input");
    registerCleanup!(() => handle.close());
    await handle.stat();
    assert.equal(new TextDecoder().decode(await handle.read(0, 1)), "a");
    await handle.read(1, 1);
    return { exitCode: 0 };
  } });
  await assert.rejects(shell.exec("handle"), operationLimit);
  assert.equal(opened.length, 1);
  assert.equal(closes, 1);
});

test("scoped comparison retains provider authority in both operand directions", async context => {
  const transport = new MockS3Client({ buckets: ["bucket"] });
  const filesystem = new S3FileSystem({ transport, bucket: "bucket" });
  await filesystem.writeFile("/one", encoder.encode("a"));
  await filesystem.writeFile("/two", encoder.encode("b"));
  assert.equal(await filesystem.compareEntry("/one", filesystem, "/two"), "distinct");
  const { shell, commands } = fixture(context, 20, filesystem);
  commands.register({ name: "compare", async execute({ fs }) {
    assert.equal(await fs.compareEntry!("/one", fs, "/two"), "distinct", "scoped self comparison");
    assert.equal(await filesystem.compareEntry("/one", fs, "/two"), "distinct", "external reverse comparison");
    assert.equal(await new ReadOnlyFileSystem(fs).compareEntry("/one", filesystem, "/two"), "distinct", "nested view comparison");
    return { exitCode: 0 };
  } });
  const result = await shell.exec("compare");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

for (const reason of [null, false, 0, "", NaN]) {
  test(`caller cancellation preserves ${String(reason)} before filesystem admission`, async context => {
    const controller = new AbortController();
    const { shell, commands, fs } = fixture(context, 0);
    const stat = context.mock.method(fs, "stat");
    commands.register({ name: "cancel", async execute({ fs }) {
      controller.abort(reason);
      await fs.stat("/");
      return { exitCode: 0 };
    } });
    await assert.rejects(shell.exec("cancel", { signal: controller.signal }), error => Object.is(error, reason));
    assert.equal(stat.mock.callCount(), 0);
  });
}

for (const reason of [null, false, 0, "", NaN]) {
  test(`operation-local falsey cancellation neither dispatches nor spends admission: ${String(reason)}`, async context => {
    const { shell, commands, fs } = fixture(context, 1);
    const stat = context.mock.method(fs, "stat");
    const controller = new AbortController();
    controller.abort(reason);
    commands.register({ name: "cancelop", async execute({ fs }) {
      await assert.rejects(fs.stat("/", { signal: controller.signal }), error => Object.is(error, reason));
      await fs.stat("/");
      return { exitCode: 0 };
    } });
    assert.equal((await shell.exec("cancelop")).exitCode, 0);
    assert.equal(stat.mock.callCount(), 1);
  });
}

test("concurrent executions on one borrowed filesystem have independent operation counters", async context => {
  const { shell, commands, fs } = fixture(context, 1);
  const release = deferred<void>();
  const entered = deferred<void>();
  let admissions = 0;
  commands.register({ name: "parallel", async execute({ fs }) {
    if (++admissions === 2) entered.resolve();
    await release.promise;
    await fs.stat("/");
    return { exitCode: 0 };
  } });
  const stat = context.mock.method(fs, "stat");
  const execution = Promise.all([shell.exec("parallel"), shell.exec("parallel")]);
  try { await Promise.race([entered.promise, execution]); }
  finally { release.resolve(); }
  assert.deepEqual((await execution).map(result => result.exitCode), [0, 0]);
  assert.equal(stat.mock.callCount(), 2);
});

test("denied write stream never acquires its input iterator", async context => {
  const { shell, commands } = fixture(context, 0);
  let acquired = 0;
  commands.register({ name: "upload", async execute({ fs }) {
    await fs.writeStream!("/data", { async *[Symbol.asyncIterator]() { acquired++; yield encoder.encode("x"); } });
    return { exitCode: 0 };
  } });
  await assert.rejects(shell.exec("upload"), operationLimit);
  assert.equal(acquired, 0);
});

for (const reason of [null, false, 0, "", NaN]) {
  test(`budget failure remains primary while falsey handle cleanup drains: ${String(reason)}`, async context => {
    const memory = new MemoryFileSystem();
    const filesystem = Object.create(memory) as FileSystem;
    let closes = 0;
    filesystem.openReadFile = async () => ({
      stat: () => memory.stat("/"), read: async () => new Uint8Array(),
      async close() { closes++; throw reason; },
    });
    const { shell, commands } = fixture(context, 1, filesystem);
    commands.register({ name: "exhaust", async execute({ fs, registerCleanup }) {
      const handle = await fs.openReadFile!("/data");
      registerCleanup!(() => handle.close());
      await handle.read(0, 1);
      return { exitCode: 0 };
    } });
    await assert.rejects(shell.exec("exhaust"), operationLimit);
    assert.equal(closes, 1);
  });
}

for (const source of ["test -e /", "cd /", "printf x > /out", "echo /*"]) {
  test(`actual builtin filesystem work observes zero admission: ${source}`, async context => {
    const fs = new MemoryFileSystem();
    const { shell } = fixture(context, 0, fs);
    const methods = ["stat", "access", "realpath", "readdir", "writeFile", "writeStream"] as const;
    const spies = methods.map(name => context.mock.method(fs, name));
    await assert.rejects(shell.exec(source), operationLimit);
    for (const spy of spies) assert.equal(spy.mock.callCount(), 0);
  });
}

test("frozen host descriptors, method receivers, capabilities and optional absence are transparent", async context => {
  const capabilities = Object.freeze({ read: true, descriptorWriteStream: true });
  const specific = Object.freeze({ readOnly: true, descriptorWriteStream: false });
  const memory = new MemoryFileSystem();
  const filesystem = Object.freeze({
    capabilities,
    async stat(path: string) { assert.equal(this, filesystem); return memory.stat(path); },
    async capabilitiesFor(path: string) { assert.equal(this, filesystem); assert.equal(path, "/selected"); return specific; },
  }) as unknown as FileSystem;
  const { shell, commands } = fixture(context, 2, filesystem);
  commands.register({ name: "transparent", async execute({ fs }) {
    assert.equal(fs.capabilities, capabilities);
    assert.equal(await fs.capabilitiesFor!("/selected"), specific);
    assert.equal(fs.readStream, undefined);
    assert.equal(fs.writeStream, undefined);
    assert.equal(fs.openReadFile, undefined);
    assert.equal("openReadFile" in fs, false);
    assert.equal(fs.stat, fs.stat);
    await fs.stat("/");
    return { exitCode: 0 };
  } });
  const result = await shell.exec("transparent");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("method assignment through the scoped filesystem updates the host without bypassing admission", async context => {
  const memory = new MemoryFileSystem();
  const stat = await memory.stat("/");
  let originalCalls = 0;
  let replacementCalls = 0;
  const filesystem = {
    capabilities: memory.capabilities,
    async stat() { originalCalls++; return stat; },
  } as unknown as FileSystem;
  const replacement: FileSystem["stat"] = async function(this: FileSystem) {
    assert.equal(this, filesystem);
    replacementCalls++;
    return { ...stat, size: 123 };
  };
  const { shell, commands } = fixture(context, 1, filesystem);
  commands.register({ name: "replace", async execute({ fs }) {
    const previous = fs.stat;
    fs.stat = replacement;
    assert.notEqual(fs.stat, previous);
    assert.equal((await fs.stat("/")).size, 123);
    await fs.stat("/");
    return { exitCode: 0 };
  } });
  await assert.rejects(shell.exec("replace"), operationLimit);
  assert.equal(filesystem.stat, replacement);
  assert.equal(originalCalls, 0);
  assert.equal(replacementCalls, 1);
});

test("scoped method assignment preserves frozen host rejection", async context => {
  const memory = new MemoryFileSystem();
  let calls = 0;
  const filesystem = Object.freeze({
    capabilities: memory.capabilities,
    async stat() { assert.equal(this, filesystem); calls++; return memory.stat("/"); },
  }) as unknown as FileSystem;
  const replacement: FileSystem["stat"] = async () => { assert.fail("frozen method replaced"); };
  const { shell, commands } = fixture(context, 1, filesystem);
  commands.register({ name: "frozen", async execute({ fs }) {
    assert.equal(Reflect.set(fs, "stat", replacement), false);
    assert.throws(() => { fs.stat = replacement; }, TypeError);
    await fs.stat("/");
    return { exitCode: 0 };
  } });
  const result = await shell.exec("frozen");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(calls, 1);
});

test("stock descriptor stream capability and storage semantics survive the scoped receiver", async context => {
  const { shell, commands, fs } = fixture(context, 3);
  commands.register({ name: "descriptor", async execute({ fs }) {
    assert.equal(fs.capabilities.descriptorWriteStream, true);
    const data = (async function* () {
      yield encoder.encode("ab");
      await fs.writeFile("/data", encoder.encode("Q"));
      yield encoder.encode("cd");
    })();
    await fs.writeStream!("/data", data, { flag: "w" });
    return { exitCode: 0 };
  } });
  const result = await shell.exec("descriptor");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(await fs.readFile("/data"), encoder.encode("Q\0cd"));
});

test("all filesystem API admissions, including optional methods, charge before dispatch", async () => {
  const names = ["access", "appendFile", "canonicalizeMissingTarget", "capabilitiesFor", "chmod", "compareEntry",
    "copyFile", "link", "lstat", "mkdir", "openReadFile", "readFile", "readStream", "readdir", "readlink",
    "realpath", "rename", "rm", "rmdir", "stat", "symlink", "truncate", "utimes", "writeFile", "writeStream"];
  await Promise.all(names.map(async name => {
    let calls = 0;
    const original = { capabilities: {}, [name]() { calls++; } } as unknown as FileSystem;
    const reason = new ShellLimitError("maxFileSystemOperations");
    const scoped = scopeFileSystem(original, () => { throw reason; }, new AbortController().signal);
    const invoke = () => Reflect.apply(Reflect.get(scoped, name) as (...args: unknown[]) => unknown, scoped, ["/"]);
    if (name === "readStream" || name === "canonicalizeMissingTarget") assert.throws(invoke, error => error === reason);
    else await assert.rejects(Promise.resolve().then(invoke), error => error === reason);
    assert.equal(calls, 0, name);
  }));
});

test("closed invocation does not leave an admitted filesystem view usable", async context => {
  const { shell, commands, fs } = fixture(context, 10);
  const stat = context.mock.method(fs, "stat");
  let retained: FileSystem | undefined;
  commands.register({ name: "retain", execute({ fs }) { retained = fs; return { exitCode: 0 }; } });
  assert.equal((await shell.exec("retain")).exitCode, 0);
  await assert.rejects(retained!.stat("/"));
  assert.equal(stat.mock.callCount(), 0);
});

test("an unstarted read stream cannot read after its Shell invocation closes", async context => {
  const { shell, commands, fs } = fixture(context, 1);
  await fs.writeFile("/data", new Uint8Array([7]));
  let retained: AsyncIterator<Uint8Array> | undefined;
  commands.register({ name: "retainstream", execute({ fs }) {
    retained = fs.readStream!("/data")[Symbol.asyncIterator]();
    return { exitCode: 0 };
  } });
  assert.equal((await shell.exec("retainstream")).exitCode, 0);
  await assert.rejects(retained!.next());
  await retained!.return?.();
});

test("unacquired read stream source cannot acquire after its Shell invocation closes", async context => {
  const memory = new MemoryFileSystem();
  const filesystem = Object.create(memory) as FileSystem;
  let acquired = 0;
  filesystem.readStream = () => ({ [Symbol.asyncIterator]() {
    acquired++;
    return { next: async () => ({ done: false, value: new Uint8Array([7]) }) };
  } });
  const { shell, commands } = fixture(context, 1, filesystem);
  let retained: ByteSource | undefined;
  commands.register({ name: "retainsource", execute({ fs }) {
    retained = fs.readStream!("/data");
    return { exitCode: 0 };
  } });
  assert.equal((await shell.exec("retainsource")).exitCode, 0);
  await assert.rejects(async () => { await retained![Symbol.asyncIterator]().next(); });
  assert.equal(acquired, 0);
});

test("budget failure drains a late handle acquisition and gated close before settling", async context => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/data", encoder.encode("x"));
  const acquisition = deferred<FileReadHandle>();
  const entered = deferred<void>();
  const closing = deferred<void>();
  const closeRelease = deferred<void>();
  const filesystem = Object.create(memory) as FileSystem;
  filesystem.openReadFile = () => { entered.resolve(); return acquisition.promise; };
  const { shell, commands } = fixture(context, 1, filesystem);
  commands.register({ name: "late", async execute({ fs, registerCleanup }) {
    let pending: Promise<FileReadHandle> | undefined;
    registerCleanup!(async () => { await (await pending)?.close(); });
    pending = fs.openReadFile!("/data");
    await entered.promise;
    await fs.stat("/");
    return { exitCode: 0 };
  } });
  let settled = false;
  const execution = shell.exec("late");
  const outcome = assert.rejects(execution, operationLimit).finally(() => { settled = true; });
  const handle = await memory.openReadFile("/data");
  try {
    await entered.promise;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    acquisition.resolve({ stat: handle.stat.bind(handle), read: handle.read.bind(handle), async close() {
      closing.resolve();
      await closeRelease.promise;
      await handle.close();
    } });
    await closing.promise;
    assert.equal(settled, false);
  } finally {
    acquisition.resolve(handle);
    closeRelease.resolve();
    await outcome;
  }
});

for (const reason of [null, false, 0, "", NaN]) {
  test(`close-only failure remains exact after handle capacity is exhausted: ${String(reason)}`, async context => {
    const memory = new MemoryFileSystem();
    const filesystem = Object.create(memory) as FileSystem;
    let closes = 0;
    filesystem.openReadFile = async () => ({
      stat: () => memory.stat("/"), read: async () => new Uint8Array(),
      async close() { closes++; throw reason; },
    });
    const { shell, commands } = fixture(context, 1, filesystem);
    commands.register({ name: "closefail", async execute({ fs, registerCleanup }) {
      const handle = await fs.openReadFile!("/data");
      registerCleanup!(() => handle.close());
      return { exitCode: 0 };
    } });
    await assert.rejects(shell.exec("closefail"), error => Object.is(error, reason));
    assert.equal(closes, 1);
  });
}
