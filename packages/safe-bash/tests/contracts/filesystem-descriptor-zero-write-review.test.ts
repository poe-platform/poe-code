import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, openFileDescriptor, FsError, type FileDescriptor, type FileDescriptorCapabilities, type FileSystem, type OpenFileOptions } from "poe-code/safe-fs";
import type { InvocationCleanup } from "../../src/contracts/command.js";
import { openCommandFile } from "../../src/contracts/filesystem-descriptor.js";
import { bindFileOutputBudget, openFileOutput } from "../../src/contracts/filesystem-output.js";
import { Budget, defaultLimits } from "../../src/shell/runtime.js";

function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

function fixture(options: {
  limit?: number;
  flag?: boolean | undefined;
  write?: (bytes: Uint8Array, position: number | null) => Promise<number>;
  expose?: (capabilities: FileDescriptorCapabilities) => FileDescriptorCapabilities;
} = {}) {
  const memory = createMemoryFileSystem();
  const controller = new AbortController();
  const budget = new Budget({ ...defaultLimits, maxOutputBytes: options.limit ?? 0 }, controller.signal);
  const cleanups: InvocationCleanup[] = [];
  const resource = { calls: 0, closes: 0 };
  const fs: FileSystem = new Proxy(memory, { get(target, key) {
    if (key === "open") return async (path: string, request: OpenFileOptions): Promise<FileDescriptor> => {
      assert.equal(cleanups.length, 1);
      const flag = Object.hasOwn(options, "flag") ? options.flag : true;
      const descriptor = await openFileDescriptor(path, request, {
        positionedRead: true, positionedWrite: true, truncate: false, openTruncate: true, synchronization: "none",
        ...(flag === undefined ? {} : { delegateZeroLengthWrite: flag }),
      }, async () => ({
        resource,
        async stat() { return { type: "character", size: 0, mode: 0o020666, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 }; },
        async read() { throw new Error("unexpected backend read"); },
        async write(retained, bytes, position) {
          retained.calls++;
          return options.write ? options.write(bytes, position) : bytes.length;
        },
        async truncate() { throw new Error("unexpected truncate"); },
        async sync() { throw new Error("unexpected sync"); },
        async close(retained) { retained.closes++; },
      }));
      if (!options.expose) return descriptor;
      const capabilities = options.expose(descriptor.capabilities);
      return new Proxy(descriptor, { get(retained, property) {
        if (property === "capabilities") return capabilities;
        const value: unknown = Reflect.get(retained, property, retained);
        return typeof value === "function" ? value.bind(retained) : value;
      } });
    };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const context = { fs, signal: budget.signal, registerCleanup: (cleanup: InvocationCleanup) => { cleanups.push(cleanup); } };
  bindFileOutputBudget(context, sink => budget.sink(sink), (bytes, write) => budget.writeCounted(bytes, write));
  return { context, budget, controller, resource, async drain() {
    try { await Promise.allSettled(cleanups.map(cleanup => cleanup())); }
    finally { budget.close(); }
  } };
}

for (const route of ["command", "output"] as const) {
  test(`independent ${route} explicit empty descriptor write preserves EPERM through real zero budget`, async context => {
    const failure = new FsError("EPERM", { syscall: "write" });
    const host = fixture({ async write() { throw failure; } });
    context.after(host.drain);
    const descriptor = route === "command"
      ? await openCommandFile(host.context, "/node", { access: "write" })
      : (await openFileOutput(host.context, "/node", { flag: "w", descriptor: true })).descriptor!;
    await assert.rejects(descriptor.write(new Uint8Array(), null), error => error === failure);
    assert.equal(host.resource.calls, 1);
    assert.equal(host.budget.bytes, 0);
    await descriptor.close();
    assert.equal(host.resource.closes, 1);
  });
}

for (const flag of [false, undefined]) test(`independent canonical default ${flag} keeps empty backend bypass`, async context => {
  const host = fixture({ flag });
  context.after(host.drain);
  const descriptor = await openCommandFile(host.context, "/node", { access: "write" });
  assert.equal(descriptor.capabilities.delegateZeroLengthWrite, flag);
  assert.equal(Object.hasOwn(descriptor.capabilities, "delegateZeroLengthWrite"), flag !== undefined);
  assert.equal(await descriptor.write(new Uint8Array(), null), 0);
  assert.equal(host.resource.calls, 0);
  assert.equal(host.budget.bytes, 0);
});

test("independent read-only mask cannot reintroduce a flag omitted by its first accessor observation", async context => {
  let observations = 0;
  const host = fixture({ expose(capabilities) {
    const exposed = { ...capabilities };
    Object.defineProperty(exposed, "delegateZeroLengthWrite", { enumerable: true, get() {
      observations++;
      return observations === 1 ? undefined : true;
    } });
    return Object.freeze(exposed);
  } });
  context.after(host.drain);
  const descriptor = await openCommandFile(host.context, "/node", { access: "read" });
  await assert.rejects(descriptor.write(new Uint8Array(), null), { code: "EBADF" });
  assert.equal(host.resource.calls, 0);
  assert.equal(descriptor.capabilities.delegateZeroLengthWrite, undefined);
  assert.equal(Object.hasOwn(descriptor.capabilities, "delegateZeroLengthWrite"), false);
  assert.equal(observations, 1);
});

test("independent readonly canonical descriptor masks true and avoids backend and byte admission", async context => {
  const host = fixture();
  context.after(host.drain);
  const descriptor = await openCommandFile(host.context, "/node", { access: "read" });
  assert.equal(descriptor.capabilities.delegateZeroLengthWrite, false);
  await assert.rejects(descriptor.write(new Uint8Array(), null), { code: "EBADF" });
  assert.equal(host.resource.calls, 0);
  assert.equal(host.budget.bytes, 0);
});

for (const reason of [false, 0, null]) test(`independent deferred empty write drains before close with root cancellation ${reason}`, async context => {
  const started = latch();
  const complete = latch();
  const host = fixture({ async write() { started.resolve(); await complete.promise; throw new FsError("EPERM"); } });
  context.after(host.drain);
  const descriptor = await openCommandFile(host.context, "/node", { access: "write" });
  const writing = descriptor.write(new Uint8Array(), null);
  const rejected = assert.rejects(writing, error => Object.is(error, reason));
  await started.promise;
  host.controller.abort(reason);
  const closing = descriptor.close();
  assert.equal(host.resource.closes, 0);
  complete.resolve();
  await rejected;
  await closing;
  assert.equal(host.resource.calls, 1);
  assert.equal(host.resource.closes, 1);
  assert.equal(host.budget.bytes, 0);
});

test("independent partial refund and later empty failure share the stdout ledger without double charging", async context => {
  const failure = new FsError("EPERM");
  const host = fixture({ limit: 3, async write(bytes) {
    if (bytes.length === 0) throw failure;
    return 1;
  } });
  context.after(host.drain);
  const stdout = host.budget.sink({ async write() {} });
  await stdout.write(Uint8Array.of(9));
  const descriptor = await openCommandFile(host.context, "/node", { access: "write" });
  assert.equal(await descriptor.write(Uint8Array.of(1, 2), null), 1);
  assert.equal(host.budget.bytes, 2);
  await assert.rejects(descriptor.write(new Uint8Array(), null), error => error === failure);
  assert.equal(host.budget.bytes, 2);
  assert.equal(await descriptor.write(Uint8Array.of(3), null), 1);
  assert.equal(host.budget.bytes, 3);
  assert.equal(host.resource.calls, 3);
});

test("independent invalid positive count for an empty write is EIO with zero charge", async context => {
  const host = fixture({ async write() { return 1; } });
  context.after(host.drain);
  const descriptor = await openCommandFile(host.context, "/node", { access: "write" });
  await assert.rejects(descriptor.write(new Uint8Array(), null), { code: "EIO" });
  assert.equal(host.resource.calls, 1);
  assert.equal(host.budget.bytes, 0);
});
