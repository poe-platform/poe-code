import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";
import {
  createMemoryFileSystem, createMountFileSystem, FsError, toByteSource,
  type ByteSource, type FileSystem,
} from "poe-code/safe-fs";
import { createDeviceFileSystem } from "../../../src/fs/devices/index.js";
import { basicCommands } from "../../../src/commands/basic.js";
import { filesystemCommands } from "../../../src/commands/filesystem.js";
import { CommandRegistry } from "../../../src/contracts/command.js";
import { Shell } from "../../../src/shell/index.js";

const execute = promisify(execFile);

for (const script of [
  "printf x >/dev/null 2>/dev/null",
  "{ printf out; printf err >&2; } >/dev/null 2>/dev/null; printf done",
  "{ printf out; printf err >&2; } >>/dev/null 2>>/dev/null; printf done",
  "{ printf out; printf err >&2; } >/dev/null 2>>/dev/null; printf done",
  "{ printf outer; { printf inner; printf err >&2; } >/dev/null 2>/dev/null; printf tail; } >/dev/null; printf done",
  "{ printf out; printf err >&2; } >/dev/null 2>&1; printf done",
  "{ printf out; printf err >&2; } 2>&1 >/dev/null",
  "{ printf hidden >&3; printf shown; } 3>/dev/null >/dev/null; printf done",
  "printf hidden >/dev/null 2>/dev/null; printf visible; printf error >&2",
]) {
  test(`review native Bash independent null descriptors: ${script}`, async () => {
    const native = await execute("/bin/bash", ["--noprofile", "--norc", "-c", script], {
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, encoding: "buffer", maxBuffer: 65536, timeout: 2000,
    });
    const shell = new Shell({
      fs: createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/dev": createDeviceFileSystem() } }),
      commands: new CommandRegistry(basicCommands()),
      limits: { maxWallClockMs: 1000 },
    });
    try {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.stdoutBytes, new Uint8Array(native.stdout));
      assert.deepEqual(result.stderrBytes, new Uint8Array(native.stderr));
    } finally { await shell.dispose(); }
  });
}

test("review capability is explicit, destination-specific, and not random access", async () => {
  const root = createMemoryFileSystem();
  const devices = createDeviceFileSystem();
  assert.equal(devices.capabilities.independentWriteStreams, true);
  assert.equal(devices.capabilities.randomAccessWrite, false);
  const mounted = createMountFileSystem({ root, mounts: { "/dev": devices } });
  assert.equal((await mounted.capabilitiesFor!("/dev/null")).independentWriteStreams, true);
  assert.notEqual((await mounted.capabilitiesFor!("/ordinary")).independentWriteStreams, true);
  await assert.rejects(root.stat("/dev/null"), { code: "ENOENT" });
});

for (const advertised of [undefined, false, 1, "true"]) {
  test(`review ordinary sequential backends still refuse shared opens: ${String(advertised)}`, async () => {
    const memory = createMemoryFileSystem();
    const fs: FileSystem = new Proxy(memory, { get(target, key) {
      if (key === "open") return undefined;
      if (key === "capabilities") return { ...memory.capabilities, open: false, randomAccessWrite: false, independentWriteStreams: advertised as boolean | undefined };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const shell = new Shell({ fs, commands: new CommandRegistry(basicCommands()) });
    try {
      const conflict = await shell.exec("printf content >/ordinary 2>/ordinary");
      assert.equal(conflict.exitCode, 1);
      assert.ok(conflict.stderr.includes("Conflicting sequential output descriptors"), conflict.stderr);
      const after = await shell.exec("printf recovered >/ordinary");
      assert.equal(after.exitCode, 0, after.stderr);
      assert.equal(new TextDecoder().decode(await memory.readFile("/ordinary")), "recovered");
    } finally { await shell.dispose(); }
  });
}

test("review path-specific refusal overrides aggregate independent-stream capability", async () => {
  const memory = createMemoryFileSystem();
  const capabilities = { ...memory.capabilities, open: false, randomAccessWrite: false, independentWriteStreams: false };
  const fs: FileSystem = new Proxy(memory, { get(target, key) {
    if (key === "open") return undefined;
    if (key === "capabilities") return { ...capabilities, independentWriteStreams: true };
    if (key === "capabilitiesFor") return async () => capabilities;
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const shell = new Shell({ fs, commands: new CommandRegistry(basicCommands()) });
  try {
    const result = await shell.exec("printf content >/ordinary 2>/ordinary");
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("Conflicting sequential output descriptors"));
  } finally { await shell.dispose(); }
});

test("review independent discard streams do not serialize lifetimes or buffer content", async () => {
  const devices = createDeviceFileSystem();
  let active = 0;
  let peak = 0;
  let fragments = 0;
  let bytes = 0;
  const fs = {
    ...devices,
    capabilities: { ...devices.capabilities, open: false },
    async writeStream(path: string, source: ByteSource, options: Parameters<typeof devices.writeStream>[2]) {
      active++;
      peak = Math.max(peak, active);
      try {
        await devices.writeStream(path, (async function* () {
          for await (const chunk of source) {
            fragments++;
            bytes += chunk.length;
            assert.ok(chunk.length <= 65536);
            yield chunk;
          }
        })(), options);
      } finally { active--; }
    },
  };
  Reflect.deleteProperty(fs, "open");
  const shell = new Shell({ fs: createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/dev": fs } }), commands: new CommandRegistry(basicCommands()) });
  shell.register({ name: "fragmented", async execute(context) {
    const payload = new Uint8Array(65536);
    for (let count = 0; count < 8; count++) {
      await context.stdout.write(payload);
      await context.stderr.write(payload);
    }
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec("fragmented >/dev/null 2>/dev/null");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(peak, 2);
    assert.equal(active, 0);
    assert.equal(bytes, 16 * 65536);
    assert.equal(fragments, 16);
    assert.equal(devices.capabilities.randomAccessWrite, false);
    assert.equal((await devices.stat("/null")).size, 0);
  } finally { await shell.dispose(); }
});

test("review failure opening a later descriptor closes earlier device streams", async () => {
  const devices = createDeviceFileSystem();
  let active = 0;
  let admissions = 0;
  let peak = 0;
  const fs = {
    ...devices,
    capabilities: { ...devices.capabilities, open: false },
    async writeStream(path: string, source: ByteSource, options: Parameters<typeof devices.writeStream>[2]) {
      active++;
      peak = Math.max(peak, active);
      try { await devices.writeStream(path, {
        [Symbol.asyncIterator]() { admissions++; return source[Symbol.asyncIterator](); },
      }, options); }
      finally { active--; }
    },
  };
  Reflect.deleteProperty(fs, "open");
  const shell = new Shell({ fs: createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/dev": fs } }), commands: new CommandRegistry(basicCommands()) });
  try {
    const failure = await shell.exec("printf x >/dev/null 2>/dev/missing");
    assert.equal(failure.exitCode, 1);
    assert.equal(active, 0);
    assert.equal(admissions, 1);
    assert.equal(peak, 2);
    peak = 0;
    assert.equal((await shell.exec("printf x >/dev/null 2>/dev/null")).exitCode, 0);
    assert.equal(active, 0);
    assert.equal(admissions, 3);
    assert.equal(peak, 2);
  } finally { await shell.dispose(); }
});

for (const budgetFailure of [false, true]) {
  test(`review dual discard streams close on ${budgetFailure ? "output budget" : "caller cancellation"}`, async () => {
    const devices = createDeviceFileSystem();
    const controller = new AbortController();
    const reason = new Error("cancel this invocation");
    let active = 0;
    let admissions = 0;
    let peak = 0;
    const fs = {
      ...devices,
      capabilities: { ...devices.capabilities, open: false },
      async writeStream(path: string, source: ByteSource, options: Parameters<typeof devices.writeStream>[2]) {
        active++;
        peak = Math.max(peak, active);
        try { await devices.writeStream(path, {
          [Symbol.asyncIterator]() { admissions++; return source[Symbol.asyncIterator](); },
        }, options); }
        finally { active--; }
      },
    };
    Reflect.deleteProperty(fs, "open");
    const shell = new Shell({
      fs: createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/dev": fs } }),
      commands: new CommandRegistry(basicCommands()),
      limits: { maxOutputBytes: 4 },
    });
    shell.register({ name: "cancel-writer", async execute(context) {
      await context.stdout.write(new Uint8Array([1]));
      controller.abort(reason);
      context.signal.throwIfAborted();
      return { exitCode: 0 };
    } });
    try {
      await assert.rejects(shell.exec(`${budgetFailure ? "printf overflow" : "cancel-writer"} >/dev/null 2>/dev/null`, { signal: controller.signal }), error => {
        if (!budgetFailure) return error === reason;
        return error instanceof Error && "limit" in error && error.limit === "maxOutputBytes";
      });
      assert.equal(active, 0);
      assert.equal(admissions, 2);
      assert.equal(peak, 2);
      peak = 0;
      const later = await shell.exec("printf ok >/dev/null 2>/dev/null");
      assert.equal(later.exitCode, 0, later.stderr);
      assert.equal(active, 0);
      assert.equal(admissions, 4);
      assert.equal(peak, 2);
    } finally { await shell.dispose(); }
  });
}

test("review device namespace rejection occurs before acquiring a write producer", async () => {
  const fs = createDeviceFileSystem();
  let acquired = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { acquired++; throw new Error("unexpected producer acquisition"); } };
  for (const [path, code] of [
    ["/null/child", "ENOTDIR"], ["/null/../zero", "ENOTDIR"],
    ["/absent/../null", "ENOENT"], ["/null/", "ENOTDIR"], ["/", "EISDIR"], ["/null\0", "EINVAL"],
  ] as const) {
    await assert.rejects(fs.writeStream(path, source), { code });
  }
  assert.equal(acquired, 0);
  const before = await fs.readdir("/");
  for (const operation of [
    () => fs.rename("/null", "/other"),
    () => fs.rm("/null", { force: true, recursive: true }), () => fs.mkdir("/other"),
  ]) await assert.rejects(operation(), { code: "ENOTSUP" });
  await assert.rejects(fs.copyFile("/zero", "/other"), { code: "ENOENT" });
  assert.deepEqual(await fs.readdir("/"), before);
});

test("review random-provider abort outranks simultaneous provider failure", async context => {
  const fs = createDeviceFileSystem();
  for (const reason of [null, false, 0, "", new FsError("ENOENT")]) {
    const controller = new AbortController();
    const replacement = context.mock.method(globalThis.crypto, "getRandomValues", () => {
      controller.abort(reason);
      throw new Error("provider also failed");
    });
    try {
      await assert.rejects(fs.readStream("/random", { signal: controller.signal })[Symbol.asyncIterator]().next(), error => error === reason);
    } finally { replacement.mock.restore(); }
  }
});

test("review pre-aborted streams do not acquire producers or touch randomness", async context => {
  const fs = createDeviceFileSystem();
  const random = context.mock.method(globalThis.crypto, "getRandomValues", () => { throw new Error("randomness acquired after abort"); });
  for (const reason of [null, false, 0, "", new FsError("ENOENT")]) {
    const signal = AbortSignal.abort(reason);
    const source: ByteSource = { [Symbol.asyncIterator]() { throw new Error("producer acquired after abort"); } };
    await assert.rejects(fs.writeStream("/null", source, { signal }), error => error === reason);
    await assert.rejects(fs.readStream("/urandom", { signal })[Symbol.asyncIterator]().next(), error => error === reason);
    await assert.rejects(fs.rm("/missing", { force: true, signal }), error => error === reason);
  }
  assert.equal(random.mock.callCount(), 0);
});

test("review canceling one discard stream does not close another", async () => {
  const fs = createDeviceFileSystem();
  const controller = new AbortController();
  const reason = new Error("close only this writer");
  let finalized = false;
  async function* source() {
    try { yield new Uint8Array([1]); controller.abort(reason); yield new Uint8Array([2]); }
    finally { finalized = true; }
  }
  const first = assert.rejects(fs.writeStream("/null", source(), { signal: controller.signal }), error => error === reason);
  await fs.writeStream("/null", toByteSource("unaffected"));
  await first;
  assert.equal(finalized, true);
  assert.deepEqual(await fs.readFile("/null"), new Uint8Array());
});

test("review mounted regular-file copy to null succeeds and preserves source", async () => {
  const root = createMemoryFileSystem();
  const devices = createDeviceFileSystem();
  const shell = new Shell({
    fs: createMountFileSystem({ root, mounts: { "/dev": devices } }),
    commands: new CommandRegistry([...basicCommands(), ...filesystemCommands()]),
  });
  try {
    const result = await shell.exec("printf x >/input; cp /input /dev/null");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.deepEqual(await root.readFile("/input"), new Uint8Array([120]));
    assert.deepEqual(await devices.readFile("/null"), new Uint8Array());
    const native = await execute("/bin/bash", ["--noprofile", "--norc", "-c", "cp /dev/null /dev/zero"], {
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, encoding: "buffer", maxBuffer: 65536, timeout: 2000,
    });
    const emptyCopy = await shell.exec("cp /dev/null /dev/zero");
    assert.equal(emptyCopy.exitCode, 0, emptyCopy.stderr);
    assert.deepEqual(emptyCopy.stdoutBytes, new Uint8Array(native.stdout));
    assert.deepEqual(emptyCopy.stderrBytes, new Uint8Array(native.stderr));
  } finally { await shell.dispose(); }
});

test("review virtual identity is stable per node, private per namespace, and survives mount aliases", async () => {
  const devices = createDeviceFileSystem();
  const other = createDeviceFileSystem();
  const entries = await Promise.all(["/", "/null", "/zero", "/random", "/urandom"].map(path => devices.stat(path)));
  const identity = entries[0]!.identityScope;
  assert.ok(typeof identity === "symbol" || typeof identity === "object" && identity !== null);
  assert.equal(new Set(entries.map(entry => entry.ino)).size, 5);
  for (const entry of entries) {
    assert.equal(entry.identityScope, identity);
    assert.equal(entry.dev, 0);
    assert.ok(Number.isSafeInteger(entry.ino));
    assert.equal(entry.rdevMajor, undefined);
    assert.equal(entry.rdevMinor, undefined);
  }
  assert.notEqual((await other.stat("/null")).identityScope, identity);
  assert.deepEqual(await devices.stat("/./null"), await devices.lstat("/null"));
  const mounted = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/dev": devices, "/alias": devices, "/other": other } });
  assert.equal((await mounted.stat("/dev/null")).identityScope, identity);
  assert.equal(await mounted.compareEntry!("/dev/null", mounted, "/alias/null"), "same");
  assert.equal(await mounted.compareEntry!("/dev/null", mounted, "/other/null"), "distinct");
  await assert.rejects(mounted.copyFile("/dev/null", "/alias/null"), { code: "EINVAL" });
});

test("review device copy really streams and cancellation terminates endless sources", async context => {
  const devices = createDeviceFileSystem();
  assert.equal(devices.capabilities.copy, true);
  assert.equal(devices.capabilities.exclusiveCopy, false);
  await devices.copyFile("/null", "/zero");
  const controller = new AbortController();
  const reason = new Error("bounded copy complete");
  let calls = 0;
  context.mock.method(globalThis.crypto, "getRandomValues", (bytes: Uint8Array) => {
    assert.ok(bytes.length <= 65536);
    bytes.fill(17);
    if (++calls === 3) controller.abort(reason);
    return bytes;
  });
  await assert.rejects(devices.copyFile("/random", "/null", { signal: controller.signal }), error => error === reason);
  assert.equal(calls, 3);
  assert.deepEqual(await devices.readFile("/null"), new Uint8Array());
  assert.equal((await devices.stat("/random")).size, 0);
});

test("review copy validates both nodes and exclusivity before any source read", async context => {
  const devices = createDeviceFileSystem();
  const random = context.mock.method(globalThis.crypto, "getRandomValues", () => { throw new Error("unexpected random read"); });
  for (const [source, destination, options, code] of [
    ["/random", "/random", {}, "EINVAL"],
    ["/random", "/./random", {}, "EINVAL"],
    ["/random", "/null", { exclusive: true }, "EEXIST"],
    ["/random", "/", {}, "EISDIR"],
    ["/", "/null", {}, "EISDIR"],
    ["/random", "/absent", {}, "ENOENT"],
    ["/random", "/null/child", {}, "ENOTDIR"],
  ] as const) await assert.rejects(devices.copyFile(source, destination, options), { code });
  const reason = new FsError("ENOENT");
  await assert.rejects(devices.copyFile("/random", "/null", { signal: AbortSignal.abort(reason) }), error => error === reason);
  assert.equal(random.mock.callCount(), 0);
});
