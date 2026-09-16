import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { deflateRawSync } from "node:zlib";
import { createMemoryFileSystem, Shell, type CommandContext, type FileSystem } from "../../src/index.js";
import { createZipCommand } from "../../src/commands/archive/zip.js";
import { createUnzipCommand } from "../../src/commands/archive/unzip.js";
import { bindFileOutputBudget } from "../../src/contracts/filesystem-output.js";
import { FsError } from "../../src/contracts/errors.js";
import { collectBytes } from "../../src/contracts/index.js";
import { settings } from "../../src/commands/archive/internal.js";
import { decodeZipEntry, readZipArchive } from "../../src/commands/archive/zip-format.js";

function checksum(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function archive(body = Buffer.from("replacement"), method = 0, corrupt = false): Buffer {
  const name = Buffer.from("file");
  const payload = method === 8 ? deflateRawSync(body) : body;
  const central = 30 + name.length + payload.length;
  const end = central + 46 + name.length;
  const bytes = Buffer.alloc(end + 22);
  bytes.writeUInt32LE(0x04034b50);
  bytes.writeUInt16LE(20, 4);
  bytes.writeUInt16LE(method, 8);
  bytes.writeUInt16LE((3 << 11) | (4 << 5) | 3, 10);
  bytes.writeUInt16LE((44 << 9) | (1 << 5) | 2, 12);
  bytes.writeUInt32LE((checksum(body) ^ (corrupt ? 1 : 0)) >>> 0, 14);
  bytes.writeUInt32LE(payload.length, 18);
  bytes.writeUInt32LE(body.length, 22);
  bytes.writeUInt16LE(name.length, 26);
  bytes.set(name, 30);
  bytes.set(payload, 30 + name.length);
  bytes.writeUInt32LE(0x02014b50, central);
  bytes.writeUInt16LE(0x0314, central + 4);
  bytes.copy(bytes, central + 6, 4, 30);
  bytes.writeUInt32LE((0o100640 * 65536) >>> 0, central + 38);
  bytes.set(name, central + 46);
  bytes.writeUInt32LE(0x06054b50, end);
  bytes.writeUInt16LE(1, end + 8);
  bytes.writeUInt16LE(1, end + 10);
  bytes.writeUInt32LE(end - central, end + 12);
  bytes.writeUInt32LE(central, end + 16);
  return bytes;
}

async function fixture(bytes = archive()): Promise<FileSystem> {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/sample.zip", bytes);
  await fs.writeFile("/work/file", Buffer.from("original"));
  return fs;
}

function wrapped(fs: FileSystem, overrides: Partial<FileSystem>): FileSystem {
  return new Proxy(fs, { get(target, property) {
    if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

async function run(fs: FileSystem, command: "zip" | "unzip", args: readonly string[], overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command, args, fs, cwd: "/work", env: {}, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { stdout.push(Uint8Array.from(bytes)); } },
    stderr: { async write(bytes) { stderr.push(Uint8Array.from(bytes)); } },
    ...overrides,
  };
  const definition = command === "zip" ? createZipCommand() : createUnzipCommand();
  const result = await definition.execute(context);
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
}

test("ZIP stdout rejects its header before draining stdin", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  let pulls = 0;
  const result = await run(fs, "zip", ["-q0", "-", "-"], {
    stdin: { async *[Symbol.asyncIterator]() { pulls++; yield Buffer.from("live"); } },
    stdout: { async write() { throw new Error("sink refused"); } },
  });
  assert.notEqual(result.exitCode, 0);
  assert.equal(pulls, 0);
});

test("ZIP live stdout awaits a slow sink and emits payload before gated EOF", { timeout: 1000 }, async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  let releaseHeader!: () => void;
  let releasePayload!: () => void;
  let releaseEof!: () => void;
  let headerSeen!: () => void;
  let payloadSeen!: () => void;
  const header = new Promise<void>(resolve => { headerSeen = resolve; });
  const payload = new Promise<void>(resolve => { payloadSeen = resolve; });
  const headerGate = new Promise<void>(resolve => { releaseHeader = resolve; });
  const payloadGate = new Promise<void>(resolve => { releasePayload = resolve; });
  const eofGate = new Promise<void>(resolve => { releaseEof = resolve; });
  let pulls = 0;
  let eof = false;
  let closed = false;
  let writes = 0;
  let seed = 91626;
  const slab = new Uint8Array(65536);
  const expected: Uint8Array[] = [];
  const chunks: Uint8Array[] = [];
  const pending = run(fs, "zip", ["-q", "-", "-"], {
    stdin: (async function* () {
      try {
        for (let index = 0; index < 16; index++) {
          for (let byte = 0; byte < slab.length; byte++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; slab[byte] = seed >>> 24; }
          expected.push(new Uint8Array(slab));
          pulls++;
          yield slab;
          slab.fill(255);
        }
        await eofGate;
        eof = true;
      } finally { closed = true; slab.fill(255); }
    })(),
    stdout: { async write(chunk) {
      writes++;
      chunks.push(new Uint8Array(chunk));
      if (writes === 1) { headerSeen(); await headerGate; }
      if (writes === 2) { payloadSeen(); await payloadGate; }
    } },
  });
  try {
    await header;
    assert.equal(pulls, 0);
    releaseHeader();
    await payload;
    assert.equal(eof, false);
    assert.ok(pulls < 16, "DEFLATE must emit without draining its producer");
    const heldPulls = pulls;
    await setImmediate();
    assert.equal(pulls, heldPulls, "slow sink must prevent further pulls");
  } finally { releaseHeader(); releasePayload(); releaseEof(); }
  const result = await pending;
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(closed, true);
  const archive = await readZipArchive(Buffer.concat(chunks), settings({}), new AbortController().signal);
  const decoded = await collectBytes(decodeZipEntry(archive.entries[0]!, settings({}), new AbortController().signal), { maxBytes: 2 * 1024 * 1024 });
  assert.equal(Buffer.from(decoded).equals(Buffer.concat(expected)), true);
});

test("ZIP STORE file writes its owned staging before gated source EOF", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/live", Buffer.alloc(1024, 97));
  let writes = 0;
  let published = false;
  const stream = wrapped(fs, {
    async *readStream(path, options) {
      yield Buffer.alloc(512, 97);
      assert.ok(writes >= 2, "header and payload must reach staging before next input");
      assert.equal(published, false);
      yield Buffer.alloc(512, 97);
    },
    async writeFileConditional(path, bytes, options) { writes++; return fs.writeFileConditional!(path, bytes, options); },
    async publishStagedFile(staging, path, options) { published = true; return fs.publishStagedFile!(staging, path, options); },
  });
  const result = await run(stream, "zip", ["-q0", "created.zip", "live"]);
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(published, true);
  assert.equal((await run(fs, "unzip", ["-p", "created.zip", "live"])).stdout.length, 1024);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["created.zip", "live"]);
});

for (const phase of ["createStagedFile", "writeFileConditional", "publishStagedFile"] as const) {
  test(`ZIP streamed file abort at ${phase} cleans staging without publication`, async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/work");
    await fs.writeFile("/work/live", Buffer.alloc(1024, 97));
    const controller = new AbortController();
    const reason = new Error(`cancel ${phase}`);
    let injected = false;
    const stream = new Proxy(fs, { get(target, method) {
      const value: unknown = Reflect.get(target, method);
      if (typeof value !== "function") return value;
      if (method === "readStream") return value.bind(target);
      return async (...args: unknown[]) => {
        if (method === phase && !injected && phase === "publishStagedFile") { injected = true; controller.abort(reason); }
        const result: unknown = await Reflect.apply(value, target, args);
        if (method === phase && !injected) { injected = true; controller.abort(reason); }
        return result;
      };
    } });
    await assert.rejects(run(stream, "zip", ["-q0", "created.zip", "live"], { signal: controller.signal }), error => error === reason);
    assert.equal(injected, true);
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["live"]);
    assert.equal((await run(fs, "zip", ["-q0", "created.zip", "live"])).exitCode, 0);
  });
}

test("ZIP live source failure leaves no file or staging publication", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/live", Buffer.alloc(1024));
  let closed = false;
  const stream = wrapped(fs, { async *readStream() {
    try { yield new Uint8Array(512); throw new Error("producer failed"); }
    finally { closed = true; }
  } });
  const result = await run(stream, "zip", ["-q0", "created.zip", "live"]);
  assert.equal(result.exitCode, 2);
  assert.equal(closed, true);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["live"]);
});

test("ZIP live conditional writes preserve a replaced staging file", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/live", Buffer.alloc(1024));
  let injected = false;
  let replacement = "";
  const stream = wrapped(fs, { async writeFileConditional(path, bytes, options) {
    if (!injected) {
      injected = true;
      replacement = path;
      await fs.rm(path);
      await fs.writeFile(path, Buffer.from("someone else's bytes"));
    }
    return fs.writeFileConditional!(path, bytes, options);
  } });
  const result = await run(stream, "zip", ["-q0", "created.zip", "live"]);
  assert.equal(result.exitCode, 2);
  assert.equal(injected, true);
  assert.equal(Buffer.from(await fs.readFile(replacement)).toString(), "someone else's bytes");
  await assert.rejects(fs.stat("/work/created.zip"), error => error instanceof FsError && error.code === "ENOENT");
});

test("ZIP live staging refuses missing conditional-write authority before input", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  let pulls = 0;
  const stream = wrapped(fs, { capabilities: { ...fs.capabilities, atomicFileMutation: false } });
  const result = await run(stream, "zip", ["-q0", "created.zip", "-"], { stdin: (async function* () { pulls++; yield new Uint8Array(512); })() });
  assert.equal(result.exitCode, 2);
  assert.equal(pulls, 0);
  assert.deepEqual(await fs.readdir("/work"), []);
});

test("ZIP live abort during cooperative input awaits producer cleanup", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  const controller = new AbortController();
  const reason = new Error("pending input aborted");
  let closed = false;
  let admitted!: () => void;
  const reading = new Promise<void>(resolve => { admitted = resolve; });
  const pending = run(fs, "zip", ["-q0", "created.zip", "-"], {
    signal: controller.signal,
    stdin: (async function* () {
      try {
        yield new Uint8Array(512);
        admitted();
        await new Promise<void>(resolve => { controller.signal.addEventListener("abort", () => resolve(), { once: true }); });
        controller.signal.throwIfAborted();
      } finally { await setImmediate(); closed = true; }
    })(),
  });
  await reading;
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.equal(closed, true);
  assert.deepEqual(await fs.readdir("/work"), []);
});

test("ZIP live sink rejection cancels a pending cooperative VFS read", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/live", Buffer.alloc(80000));
  const controller = new AbortController();
  let closed = false;
  let rejected!: () => void;
  const rejection = new Promise<void>(resolve => { rejected = resolve; });
  const stream = wrapped(fs, { async *readStream(path, options) {
    try {
      let seed = 91626;
      const bytes = new Uint8Array(40000);
      for (let index = 0; index < bytes.length; index++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; bytes[index] = seed >>> 24; }
      yield bytes;
      await new Promise<void>(resolve => { options!.signal!.addEventListener("abort", () => resolve(), { once: true }); });
      options!.signal!.throwIfAborted();
    } finally { closed = true; }
  } });
  let writes = 0;
  const pending = run(stream, "zip", ["-q", "-", "live"], { signal: controller.signal, stdout: { async write() {
    if (++writes === 2) { rejected(); throw new Error("sink rejected"); }
  } } });
  await rejection;
  await setImmediate();
  const retiredBeforeCallerAbort = closed;
  if (!closed) controller.abort(new Error("test cleanup"));
  const result = await pending.catch(() => undefined);
  assert.equal(retiredBeforeCallerAbort, true);
  assert.equal(result?.exitCode, 2);
});

test("zip review: late hardlink during output admission cannot mutate the new alias", async () => {
  const original = archive();
  const fs = await fixture(original);
  const registerCleanup: NonNullable<CommandContext["registerCleanup"]> = () => {};
  let admitted = false;
  bindFileOutputBudget({ registerCleanup }, sink => ({ async write(bytes) {
    await fs.link!("/work/sample.zip", "/work/alias");
    admitted = true;
    await sink.write(bytes);
  } }));
  const result = await run(fs, "zip", ["sample.zip", "file"], { registerCleanup });
  assert.equal(admitted, true);
  assert.deepEqual(await fs.readFile("/work/alias"), Uint8Array.from(original), "late backing alias must retain original archive bytes");
  assert.deepEqual(await fs.readFile("/work/sample.zip"), Uint8Array.from(original));
  assert.equal(result.exitCode, 2);
});

test("zip review: replacement during capability lookup cannot redirect publication", async () => {
  const original = archive();
  const fs = await fixture(original);
  await fs.writeFile("/outside", Buffer.from("outside sentinel"));
  let replaced = false;
  const dynamic = wrapped(fs, { async capabilitiesFor(path) {
    if (path === "/work/sample.zip" && !replaced) {
      replaced = true;
      await fs.rename(path, "/work/held.zip");
      await fs.symlink!("/outside", path);
    }
    return fs.capabilities;
  } });
  const result = await run(dynamic, "zip", ["sample.zip", "file"]);
  assert.equal(replaced, true);
  assert.deepEqual(Buffer.from(await fs.readFile("/outside")), Buffer.from("outside sentinel"));
  assert.deepEqual(await fs.readFile("/work/held.zip"), Uint8Array.from(original));
  assert.equal(await fs.readlink!("/work/sample.zip"), "/outside");
  assert.equal(result.exitCode, 2);
});

test("unzip review: replaced staging symlink cannot change outside metadata before rejection", async () => {
  const fs = await fixture();
  await fs.writeFile("/outside", Buffer.from("outside sentinel"), { mode: 0o604 });
  await fs.utimes!("/outside", 946684800000, 946684800000);
  const before = await fs.stat("/outside");
  let staging = "";
  const dynamic = wrapped(fs, { async createStagedFile(directory, name, content, options) {
    const receipt = await fs.createStagedFile!(directory, name, content, options);
    const path = receipt.file.path;
    if (path.startsWith("/work/.unzip-")) {
      staging = path;
      await fs.rename(path, "/work/held-stage");
      await fs.symlink!("/outside", path);
    }
    return receipt;
  } });
  const result = await run(dynamic, "unzip", ["-o", "sample.zip"]);
  assert.notEqual(staging, "");
  assert.equal(result.exitCode, 2);
  assert.deepEqual(Buffer.from(await fs.readFile("/work/file")), Buffer.from("original"));
  assert.deepEqual(Buffer.from(await fs.readFile("/outside")), Buffer.from("outside sentinel"));
  const after = await fs.stat("/outside");
  assert.deepEqual({ mode: after.mode, mtimeMs: after.mtimeMs },
    { mode: before.mode, mtimeMs: before.mtimeMs });
  assert.equal(await fs.readlink!(staging), "/outside");
});

test("zip review: Info-ZIP odd-second DOS rounding carries into the next minute", async () => {
  const previous = process.env.TZ;
  process.env.TZ = "UTC";
  try {
    const fs = await fixture();
    const modified = Date.parse("2024-01-02T03:04:59Z");
    await fs.utimes!("/work/file", modified, modified);
    const result = await run(fs, "zip", ["fresh.zip", "file"]);
    assert.equal(result.exitCode, 0, result.stderr.toString());
    const bytes = Buffer.from(await fs.readFile("/work/fresh.zip"));
    const central = bytes.readUInt32LE(bytes.length - 6);
    assert.deepEqual([bytes.readUInt16LE(10), bytes.readUInt16LE(central + 12)], [(3 << 11) | (5 << 5), (3 << 11) | (5 << 5)]);
    const extra = 30 + bytes.readUInt16LE(26);
    assert.equal(bytes.readUInt16LE(extra), 0x5455);
    assert.equal(bytes.readInt32LE(extra + 5), modified / 1000);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("unzip review: DOS-only timestamps use local time rather than UTC", async () => {
  const previous = process.env.TZ;
  process.env.TZ = "Etc/GMT+5";
  try {
    const fs = await fixture();
    const result = await run(fs, "unzip", ["-o", "sample.zip"]);
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.deepEqual(Buffer.from(await fs.readFile("/work/file")), Buffer.from("replacement"));
    assert.equal((await fs.stat("/work/file")).mtimeMs, Date.parse("2024-01-02T08:04:06Z"));
    const listing = await run(fs, "unzip", ["-l", "sample.zip"]);
    assert.equal(listing.stdout.toString(), "Archive:  sample.zip\n  Length      Date    Time    Name\n---------  ---------- -----   ----\n       11  2024-01-02 03:04   file\n---------                     -------\n       11                     1 file\n");
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("zip review: DOS headers use local wall time while UT extras retain the instant", async () => {
  const previous = process.env.TZ;
  process.env.TZ = "Etc/GMT+5";
  try {
    const fs = await fixture();
    const modified = Date.parse("2024-01-02T03:04:06Z");
    await fs.utimes!("/work/file", modified, modified);
    const result = await run(fs, "zip", ["fresh.zip", "file"]);
    assert.equal(result.exitCode, 0, result.stderr.toString());
    const bytes = Buffer.from(await fs.readFile("/work/fresh.zip"));
    const central = bytes.readUInt32LE(bytes.length - 6);
    const expectedDate = (44 << 9) | (1 << 5) | 1;
    const expectedTime = (22 << 11) | (4 << 5) | 3;
    assert.deepEqual([bytes.readUInt16LE(10), bytes.readUInt16LE(12), bytes.readUInt16LE(central + 12), bytes.readUInt16LE(central + 14)],
      [expectedTime, expectedDate, expectedTime, expectedDate]);
    const extra = 30 + bytes.readUInt16LE(26);
    assert.equal(bytes.readUInt16LE(extra), 0x5455);
    assert.equal(bytes.readInt32LE(extra + 5), modified / 1000);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("unzip review: falsey cancellation after staging creation waits for cleanup", async () => {
  const original = archive(Buffer.alloc(4096, 65), 8);
  const fs = await fixture(original);
  const controller = new AbortController();
  let appended = false;
  const dynamic = wrapped(fs, { async createStagedFile(directory, name, content, options) {
    const receipt = await fs.createStagedFile!(directory, name, content, options);
    const path = receipt.file.path;
    if (path.startsWith("/work/.unzip-")) {
      appended = true;
      controller.abort(false);
    }
    return receipt;
  } });
  await assert.rejects(run(dynamic, "unzip", ["-o", "sample.zip"], { signal: controller.signal }), reason => reason === false);
  assert.equal(appended, true);
  assert.deepEqual(Buffer.from(await fs.readFile("/work/file")), Buffer.from("original"));
  assert.deepEqual(await fs.readFile("/work/sample.zip"), Uint8Array.from(original));
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["file", "sample.zip"]);
});

for (const method of [0, 8]) test(`unzip review: method ${method} charges corrupt decoded bytes before CRC rejection`, async () => {
  const original = archive(Buffer.alloc(4096, 65), method, true);
  const fs = await fixture(original);
  const registerCleanup: NonNullable<CommandContext["registerCleanup"]> = () => {};
  let charged = 0;
  bindFileOutputBudget({ registerCleanup }, sink => ({ async write(bytes) {
    charged += bytes.length;
    await sink.write(bytes);
  } }));
  const result = await run(fs, "unzip", ["-o", "sample.zip"], { registerCleanup });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr.toString(), /CRC32/u);
  assert.equal(charged, 4096);
  assert.deepEqual(Buffer.from(await fs.readFile("/work/file")), Buffer.from("original"));
  assert.deepEqual(await fs.readFile("/work/sample.zip"), Uint8Array.from(original));
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["file", "sample.zip"]);
});

for (const stop of ["caller", "dispose"]) test(`zip review: actual Shell ${stop} cancellation drains an admitted publication write`, async () => {
  const original = archive();
  const fs = await fixture(original);
  const controller = new AbortController();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let finishHost!: () => void;
  const hostFinished = new Promise<void>(resolve => { finishHost = resolve; });
  let entered = false;
  let completed = false;
  let writeSignal: AbortSignal | undefined;
  let settled = false;
  let disposed = false;
  let disposal: Promise<void> | undefined;
  const dynamic = wrapped(fs, { async createStagedFile(path, name, content, options) {
    entered = true;
    writeSignal = options?.signal;
    try {
      await gate;
      return await fs.createStagedFile!(path, name, content, options);
    } finally { completed = true; finishHost(); }
  } });
  const shell = new Shell({ fs: dynamic, cwd: "/work" });
  shell.commands.register(createZipCommand());
  const execution = shell.exec("zip sample.zip file", { signal: controller.signal });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    for (let turn = 0; turn < 64 && !entered && !settled; turn++) await setImmediate();
    assert.equal(entered, true, "publication write must be admitted before cancellation");
    if (stop === "caller") controller.abort(false);
    else {
      disposal = shell.dispose();
      void disposal.then(() => { disposed = true; }, () => { disposed = true; });
    }
    for (let turn = 0; turn < 16; turn++) await setImmediate();
    assert.equal(writeSignal?.aborted, true);
    assert.deepEqual({ completed, execSettled: settled, disposeSettled: disposed },
      { completed: false, execSettled: false, disposeSettled: false }, "public settlement must wait for admitted write cleanup");
    release();
    await assert.rejects(execution, reason => Object.is(reason, stop === "caller" ? false : writeSignal?.reason));
    assert.equal(completed, true);
    if (disposal) await disposal;
    else assert.equal((await shell.exec(":")).exitCode, 0);
    assert.deepEqual(await fs.readFile("/work/sample.zip"), Uint8Array.from(original));
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["file", "sample.zip"]);
  } finally {
    release();
    await execution.catch(() => {});
    if (entered) await hostFinished;
    await shell.dispose();
  }
});

test("zip review: actual Shell atomic allocation ENOSPC before publication preserves the previous archive", async () => {
  const original = archive();
  const fs = await fixture(original);
  let failedPath: string | undefined;
  const dynamic = wrapped(fs, { async createStagedFile(path) {
    failedPath = path;
    throw new FsError("ENOSPC", { path, syscall: "createStagedFile" });
  } });
  const shell = new Shell({ fs: dynamic, cwd: "/work" });
  shell.commands.register(createZipCommand());
  try {
    const result = await shell.exec("zip sample.zip file");
    assert.notEqual(failedPath, undefined, "the backend must attempt atomic allocation before reporting ENOSPC");
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /ENOSPC/u);
    assert.deepEqual(await fs.readFile("/work/sample.zip"), Uint8Array.from(original), "failed prepublication write must not destroy the existing ZIP");
    assert.deepEqual(Buffer.from(await fs.readFile("/work/file")), Buffer.from("original"));
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["file", "sample.zip"]);
    assert.equal((await shell.exec(":")).exitCode, 0);
  } finally { await shell.dispose(); }
});

test("zip review: actual Shell cancellation drains a delayed source pull and late iterator return", async () => {
  const original = archive();
  const fs = await fixture(original);
  const controller = new AbortController();
  let releaseRead!: () => void;
  const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
  let releaseClose!: () => void;
  const closeGate = new Promise<void>(resolve => { releaseClose = resolve; });
  let finishRead!: () => void;
  const readFinished = new Promise<void>(resolve => { finishRead = resolve; });
  let finishClose!: () => void;
  const closeFinished = new Promise<void>(resolve => { finishClose = resolve; });
  let entered = false;
  let closing = false;
  let closed = false;
  let settled = false;
  let sourceSignal: AbortSignal | undefined;
  const dynamic = wrapped(fs, { readStream(path, options) {
    if (path !== "/work/file") return fs.readStream!(path, options);
    sourceSignal = options?.signal;
    return { [Symbol.asyncIterator]() { return {
      async next() {
        entered = true;
        try {
          await readGate;
          options?.signal?.throwIfAborted();
          return { done: false, value: Buffer.from("original") };
        } finally { finishRead(); }
      },
      async return() {
        closing = true;
        await closeGate;
        closed = true;
        finishClose();
        return { done: true, value: undefined };
      },
    }; } };
  } });
  const shell = new Shell({ fs: dynamic, cwd: "/work" });
  shell.commands.register(createZipCommand());
  const execution = shell.exec("zip sample.zip file", { signal: controller.signal });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    for (let turn = 0; turn < 64 && !entered && !settled; turn++) await setImmediate();
    assert.equal(entered, true);
    controller.abort(false);
    for (let turn = 0; turn < 16; turn++) await setImmediate();
    const settledBeforeRead = settled;
    assert.equal(sourceSignal?.aborted, true);
    releaseRead();
    for (let turn = 0; turn < 64 && !closing; turn++) await setImmediate();
    assert.equal(closing, true, "the acquired iterator must receive return after cancellation");
    assert.equal(closed, false);
    const settledBeforeReturn = settled;
    releaseClose();
    await assert.rejects(execution, reason => reason === false);
    await readFinished;
    await closeFinished;
    assert.deepEqual({ settledBeforeRead, settledBeforeReturn }, { settledBeforeRead: false, settledBeforeReturn: false });
    assert.deepEqual(await fs.readFile("/work/sample.zip"), Uint8Array.from(original));
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["file", "sample.zip"]);
    assert.equal((await shell.exec(":")).exitCode, 0);
  } finally {
    controller.abort(false);
    releaseRead();
    releaseClose();
    await execution.catch(() => {});
    if (entered) await readFinished;
    if (closing) await closeFinished;
    await shell.dispose();
  }
});

for (const phase of ["metadata", "buffered input"]) test(`zip review: actual Shell cancellation drains admitted ${phase}`, async () => {
  const original = archive();
  const fs = await fixture(original);
  const controller = new AbortController();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let finishHost!: () => void;
  const hostFinished = new Promise<void>(resolve => { finishHost = resolve; });
  let entered = false;
  let completed = false;
  let settled = false;
  let hostSignal: AbortSignal | undefined;
  const dynamic = wrapped(fs, {
    capabilities: { ...fs.capabilities, streamingRead: phase !== "buffered input" },
    async stat(path, options) {
      if (phase !== "metadata" || path !== "/work/file") return fs.stat(path, options);
      entered = true;
      hostSignal = options?.signal;
      try { await gate; return await fs.stat(path, options); }
      finally { completed = true; finishHost(); }
    },
    async readFile(path, options) {
      if (phase !== "buffered input" || path !== "/work/file") return fs.readFile(path, options);
      entered = true;
      hostSignal = options?.signal;
      try { await gate; return await fs.readFile(path, options); }
      finally { completed = true; finishHost(); }
    },
  });
  const shell = new Shell({ fs: dynamic, cwd: "/work" });
  shell.commands.register(createZipCommand());
  const execution = shell.exec("zip sample.zip file", { signal: controller.signal });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    for (let turn = 0; turn < 64 && !entered && !settled; turn++) await setImmediate();
    assert.equal(entered, true);
    controller.abort(false);
    for (let turn = 0; turn < 16; turn++) await setImmediate();
    assert.equal(hostSignal?.aborted, true);
    const early = { completed, settled };
    release();
    await assert.rejects(execution, reason => reason === false);
    await hostFinished;
    assert.deepEqual(early, { completed: false, settled: false });
    assert.deepEqual(await fs.readFile("/work/sample.zip"), Uint8Array.from(original));
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["file", "sample.zip"]);
    assert.equal((await shell.exec(":")).exitCode, 0);
  } finally {
    controller.abort(false);
    release();
    await execution.catch(() => {});
    if (entered) await hostFinished;
    await shell.dispose();
  }
});

test("unzip review: actual Shell abort after staging creation removes its temporary without outside effects", async () => {
  const original = archive(Buffer.alloc(4096, 65), 8);
  const fs = await fixture(original);
  await fs.writeFile("/outside", Buffer.from("outside sentinel"), { mode: 0o604 });
  await fs.utimes!("/outside", 946684800000, 946684800000);
  const controller = new AbortController();
  let appended = false;
  const dynamic = wrapped(fs, { async createStagedFile(directory, name, content, options) {
    const receipt = await fs.createStagedFile!(directory, name, content, options);
    const path = receipt.file.path;
    if (path.startsWith("/work/.unzip-")) {
      appended = true;
      controller.abort(false);
    }
    return receipt;
  } });
  const shell = new Shell({ fs: dynamic, cwd: "/work" });
  shell.commands.register(createUnzipCommand());
  try {
    await assert.rejects(shell.exec("unzip -o sample.zip", { signal: controller.signal }), reason => reason === false);
    assert.equal(appended, true);
    assert.deepEqual(Buffer.from(await fs.readFile("/work/file")), Buffer.from("original"));
    assert.deepEqual(await fs.readFile("/work/sample.zip"), Uint8Array.from(original));
    assert.deepEqual(Buffer.from(await fs.readFile("/outside")), Buffer.from("outside sentinel"));
    const outside = await fs.stat("/outside");
    assert.deepEqual({ mode: outside.mode & 0o777, mtimeMs: outside.mtimeMs }, { mode: 0o604, mtimeMs: 946684800000 });
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["file", "sample.zip"]);
    assert.equal((await shell.exec(":")).exitCode, 0);
  } finally { await shell.dispose(); }
});

test("zip review: new archives honor a 0644-default VFS while updates preserve existing mode", async () => {
  const fs = await fixture();
  const defaults = wrapped(fs, { async writeFile(path, bytes, options) {
    await fs.writeFile(path, bytes, { ...options, mode: options?.mode ?? 0o644 });
  }, async createStagedFile(path, name, content, options) {
    return fs.createStagedFile!(path, name, content, { ...options, mode: options.mode ?? 0o644 });
  } });
  await defaults.writeFile("/work/default-file", Buffer.from("mode control"));
  const defaultMode = (await fs.stat("/work/default-file")).mode & 0o777;
  assert.equal(defaultMode, 0o644);
  await fs.chmod!("/work/sample.zip", 0o640);
  const shell = new Shell({ fs: defaults, cwd: "/work" });
  shell.commands.register(createZipCommand());
  try {
    const updated = await shell.exec("zip sample.zip file");
    assert.equal(updated.exitCode, 0, updated.stderr);
    assert.equal((await fs.stat("/work/sample.zip")).mode & 0o777, 0o640);
    const updatedBytes = Buffer.from(await fs.readFile("/work/sample.zip"));
    assert.equal(updatedBytes.readUInt32LE(14), checksum(Buffer.from("original")));
    const created = await shell.exec("zip fresh.zip file");
    assert.equal(created.exitCode, 0, created.stderr);
    const createdBytes = Buffer.from(await fs.readFile("/work/fresh.zip"));
    assert.equal(createdBytes.readUInt32LE(14), checksum(Buffer.from("original")));
    assert.equal((await fs.stat("/work/fresh.zip")).mode & 0o777, defaultMode, "archive creation must not widen the VFS default permissions");
    assert.deepEqual(Buffer.from(await fs.readFile("/work/file")), Buffer.from("original"));
  } finally { await shell.dispose(); }
});

test("zip review: replaced staging directory cannot redirect archive mode restoration outside", async () => {
  const original = archive();
  const fs = await fixture(original);
  await fs.chmod!("/work/sample.zip", 0o640);
  await fs.mkdir("/outside");
  let replaced = false;
  let stagingDirectory = "";
  let outsideBytes: Uint8Array | undefined;
  const dynamic = wrapped(fs, { async createStagedFile(path, name, content, options) {
    const receipt = await fs.createStagedFile!(path, name, content, options);
    assert.equal(content.type, "file");
    const bytes = content.type === "file" ? content.data : new Uint8Array();
    outsideBytes = Uint8Array.from(bytes);
    await fs.writeFile("/outside/archive.zip", bytes, { mode: 0o600 });
    await fs.utimes!("/outside/archive.zip", 946684800000, 946684800000);
    stagingDirectory = path;
    await fs.rename(stagingDirectory, "/work/held-stage");
    await fs.symlink!("/outside", stagingDirectory);
    replaced = true;
    return receipt;
  } });
  const shell = new Shell({ fs: dynamic, cwd: "/work" });
  shell.commands.register(createZipCommand());
  try {
    const result = await shell.exec("zip sample.zip file");
    assert.equal(replaced, true);
    assert.equal(result.exitCode, 2);
    assert.deepEqual(await fs.readFile("/work/sample.zip"), Uint8Array.from(original));
    assert.equal((await fs.stat("/work/sample.zip")).mode & 0o777, 0o640);
    assert.deepEqual(await fs.readFile("/outside/archive.zip"), outsideBytes);
    assert.equal(await fs.readlink!(stagingDirectory), "/outside");
    const outside = await fs.stat("/outside/archive.zip");
    assert.deepEqual({ mode: outside.mode & 0o777, mtimeMs: outside.mtimeMs }, { mode: 0o600, mtimeMs: 946684800000 },
      "atomic publication must reject the original staging parent after replacement");
  } finally { await shell.dispose(); }
});
