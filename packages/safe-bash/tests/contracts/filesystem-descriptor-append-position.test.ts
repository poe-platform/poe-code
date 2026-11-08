import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, FsError, type FileDescriptor, type FileSystem, type FsOptions, type OpenFileOptions } from "poe-code/safe-fs";
import type { InvocationCleanup } from "../../src/contracts/command.js";
import { openCommandFile } from "../../src/contracts/filesystem-descriptor.js";
import { bindFileOutputBudget, openFileOutput } from "../../src/contracts/filesystem-output.js";

function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(options: {
  advertised?: boolean | undefined;
  base?: boolean;
  limit?: number;
  partial?: number;
  beforeWrite?: (options: FsOptions) => Promise<void>;
  close?: () => Promise<void>;
} = {}) {
  const memory = createMemoryFileSystem();
  const controller = new AbortController();
  const cleanups: InvocationCleanup[] = [];
  const resource = { bytes: [10, 11, 12, 13, 14, 15], cursor: 2, charged: 0, closes: 0, writes: [] as { position: number | null; bytes: number[] }[] };
  const advertised = Object.hasOwn(options, "advertised") ? options.advertised : true;
  const fs: FileSystem = new Proxy(memory, { get(target, key) {
    if (key === "open") return async (_path: string, request: OpenFileOptions): Promise<FileDescriptor> => {
      assert.equal(cleanups.length, 1);
      const positionedWrite = (options.base ?? true) && (!request.append || advertised === true);
      const capabilities: FileDescriptor["capabilities"] & { readonly positionedAppendWrite?: boolean } = {
        positionedRead: true, positionedWrite, truncate: true, position: true, synchronization: "none",
        ...(advertised === undefined ? {} : { positionedAppendWrite: advertised }),
      };
      let closed = false;
      return {
        capabilities: Object.freeze(capabilities),
        async getPosition() { return resource.cursor; },
        async stat() { return memory.stat("/"); },
        async read(buffer, position) {
          if (closed || request.access === "write") throw new FsError("EBADF", { syscall: "read" });
          const offset = position ?? resource.cursor;
          const count = Math.min(buffer.length, Math.max(0, resource.bytes.length - offset));
          buffer.set(resource.bytes.slice(offset, offset + count));
          if (position === null) resource.cursor += count;
          return count;
        },
        async write(buffer, position, supplied = {}) {
          assert.equal(closed, false);
          resource.writes.push({ position, bytes: Array.from(buffer) });
          if (request.access === "read") throw new FsError("EBADF", { syscall: "write" });
          if (position !== null && !positionedWrite) throw new FsError("EINVAL", { syscall: "write" });
          await options.beforeWrite?.(supplied);
          supplied.signal?.throwIfAborted();
          const count = Math.min(buffer.length, options.partial ?? buffer.length);
          const offset = position ?? (request.append ? resource.bytes.length : resource.cursor);
          assert.ok(Number.isSafeInteger(offset) && offset >= 0 && offset + count <= 64);
          for (let index = 0; index < count; index++) resource.bytes[offset + index] = buffer[index]!;
          if (position === null) resource.cursor = offset + count;
          return count;
        },
        async truncate() { throw new Error("truncate is not part of this fixture"); },
        async sync() { assert.equal(closed, false); },
        async close() {
          assert.equal(closed, false);
          closed = true;
          resource.closes++;
          await options.close?.();
        },
      };
    };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const context = { fs, signal: controller.signal, registerCleanup: (cleanup: InvocationCleanup) => { cleanups.push(cleanup); } };
  bindFileOutputBudget(context, sink => sink, async (chunk, write) => {
    if (chunk.length > (options.limit ?? 32) - resource.charged) throw new Error("fixture output quota");
    resource.charged += chunk.length;
    const accepted = await write();
    resource.charged -= chunk.length - accepted;
    return accepted;
  });
  return { context, controller, cleanups, resource };
}

for (const advertised of [true, false, undefined]) {
  for (const base of [true, false]) {
    for (const access of ["read", "write", "readwrite"] as const) test(`append capability: flag=${advertised}, base=${base}, command access=${access}`, async context => {
      const host = fixture({ advertised, base });
      const descriptor = await openCommandFile(host.context, "/retained", { access, append: true });
      context.after(() => descriptor.close());
      assert.equal(Reflect.get(descriptor.capabilities, "positionedAppendWrite"), advertised === true ? base && access !== "read" : advertised);
      assert.equal(Object.hasOwn(descriptor.capabilities, "positionedAppendWrite"), advertised !== undefined);
      assert.equal(descriptor.capabilities.positionedWrite, base && advertised === true && access !== "read");
      assert.equal(host.resource.writes.length, 0);
      assert.equal(host.resource.charged, 0);
      if (access === "read") {
        await assert.rejects(descriptor.write(Uint8Array.of(1), 0), { code: "EBADF" });
        assert.equal(host.resource.writes.length, 0);
        assert.equal(host.resource.charged, 0);
      } else if (!base || advertised !== true) {
        await assert.rejects(descriptor.write(Uint8Array.of(1), 0), { code: "EINVAL" });
        assert.equal(host.resource.charged, 1);
        assert.deepEqual(host.resource.bytes, [10, 11, 12, 13, 14, 15]);
        assert.equal(await descriptor.getPosition!(), 2);
      }
    });

    test(`nonappend capability remains governed by base support, flag=${advertised}, base=${base}`, async context => {
      const host = fixture({ advertised, base });
      const descriptor = await openCommandFile(host.context, "/retained", { access: "write", append: false });
      context.after(() => descriptor.close());
      assert.equal(descriptor.capabilities.positionedWrite, base);
      assert.equal(Reflect.get(descriptor.capabilities, "positionedAppendWrite"), advertised === true ? base : advertised);
      assert.equal(Object.hasOwn(descriptor.capabilities, "positionedAppendWrite"), advertised !== undefined);
    });

    test(`output retained append descriptor preserves support, flag=${advertised}, base=${base}`, async context => {
      const host = fixture({ advertised, base });
      const output = await openFileOutput(host.context, "/retained", { flag: "a", descriptor: true });
      context.after(() => output.finish());
      assert.equal(Reflect.get(output.descriptor!.capabilities, "positionedAppendWrite"), advertised === true ? base : advertised);
      assert.equal(Object.hasOwn(output.descriptor!.capabilities, "positionedAppendWrite"), advertised !== undefined);
      assert.equal(output.descriptor!.capabilities.positionedWrite, base && advertised === true);
      if (!base || advertised !== true) {
        await assert.rejects(output.descriptor!.write(Uint8Array.of(1), 0), { code: "EINVAL" });
        assert.equal(host.resource.charged, 1);
      }
    });
  }
}

const routes = [
  { name: "command", async open(host: ReturnType<typeof fixture>) {
    const descriptor = await openCommandFile(host.context, "/retained", { access: "readwrite", append: true });
    return { descriptor, finish: descriptor.close };
  } },
  { name: "output", async open(host: ReturnType<typeof fixture>) {
    const output = await openFileOutput(host.context, "/retained", { flag: "a", descriptor: true });
    return { descriptor: output.descriptor!, finish: () => output.finish() };
  } },
];

for (const route of routes) {
  test(`${route.name} preserves positioned offsets independently of sequential append cursor`, async context => {
    const host = fixture();
    const opened = await route.open(host);
    context.after(opened.finish);
    assert.equal(await opened.descriptor.write(Uint8Array.of(40, 41), 1), 2);
    assert.equal(await opened.descriptor.getPosition!(), 2);
    assert.deepEqual(host.resource.bytes, [10, 40, 41, 13, 14, 15]);
    assert.equal(await opened.descriptor.write(Uint8Array.of(50), null), 1);
    assert.equal(await opened.descriptor.getPosition!(), 7);
    assert.equal(await opened.descriptor.write(Uint8Array.of(60), 0), 1);
    assert.equal(await opened.descriptor.getPosition!(), 7);
    assert.deepEqual(host.resource.bytes, [60, 40, 41, 13, 14, 15, 50]);
    assert.deepEqual(host.resource.writes.map(call => call.position), [1, null, 0]);
    assert.equal(host.resource.charged, 4);
  });

  test(`${route.name} partial positioned writes refund only successful unaccepted bytes`, async context => {
    const host = fixture({ partial: 2, limit: 4 });
    const opened = await route.open(host);
    context.after(opened.finish);
    assert.equal(await opened.descriptor.write(Uint8Array.of(20, 21, 22), 1), 2);
    assert.equal(host.resource.charged, 2);
    assert.equal(await opened.descriptor.getPosition!(), 2);
    assert.deepEqual(host.resource.bytes, [10, 20, 21, 13, 14, 15]);
    assert.equal(await opened.descriptor.write(Uint8Array.of(30, 31), 4), 2);
    assert.equal(host.resource.charged, 4);
    await assert.rejects(opened.descriptor.write(Uint8Array.of(99), 0), { message: "fixture output quota" });
    assert.equal(host.resource.writes.length, 2);
    assert.deepEqual(host.resource.bytes, [10, 20, 21, 13, 30, 31]);
  });

  for (const reason of [undefined, null, false, 0, "", new FsError("EIO"), new FsError("ENOSPC")]) test(`${route.name} retains genuine positioned-write failure ${String(reason)} and conservative reservation`, async context => {
    const host = fixture({ limit: 3, beforeWrite: async () => { throw reason; } });
    const opened = await route.open(host);
    context.after(opened.finish);
    await assert.rejects(opened.descriptor.write(Uint8Array.of(1, 2, 3), 0), error => Object.is(error, reason));
    assert.equal(host.resource.charged, 3);
    assert.deepEqual(host.resource.bytes, [10, 11, 12, 13, 14, 15]);
    assert.equal(await opened.descriptor.getPosition!(), 2);
    await assert.rejects(opened.descriptor.write(Uint8Array.of(4), 1), { message: "fixture output quota" });
    assert.equal(host.resource.writes.length, 1);
  });

  for (const reason of [null, false, 0, ""]) test(`${route.name} preadmission cancellation ${String(reason)} does not reserve bytes or retire output`, async context => {
    const host = fixture({ limit: 2 });
    const opened = await route.open(host);
    context.after(opened.finish);
    const local = new AbortController();
    local.abort(reason);
    await assert.rejects(opened.descriptor.write(Uint8Array.of(1), 0, { signal: local.signal }), error => Object.is(error, reason));
    assert.equal(host.resource.writes.length, 0);
    assert.equal(host.resource.charged, 0);
    assert.equal(await opened.descriptor.write(Uint8Array.of(2, 3), 0), 2);
    assert.equal(host.resource.charged, 2);
  });

  for (const reason of [null, false, 0, ""]) test(`${route.name} root cancellation ${String(reason)} drains admitted write without quota refund`, { timeout: 2000 }, async context => {
    const entered = deferred();
    const release = deferred();
    const host = fixture({ limit: 3, beforeWrite: async () => { entered.resolve(); await release.promise; } });
    const opened = await route.open(host);
    context.after(async () => { release.resolve(); await Promise.allSettled([opened.finish(), ...host.cleanups.map(cleanup => cleanup())]); });
    const rejected = assert.rejects(opened.descriptor.write(Uint8Array.of(1, 2, 3), 0), error => Object.is(error, reason));
    await entered.promise;
    host.controller.abort(reason);
    assert.equal(host.resource.closes, 0);
    assert.equal(host.resource.charged, 3);
    release.resolve();
    await rejected;
    await Promise.allSettled([opened.finish(), ...host.cleanups.map(cleanup => cleanup())]);
    assert.equal(host.resource.closes, 1);
    assert.equal(host.resource.charged, 3);
    assert.deepEqual(host.resource.bytes, [10, 11, 12, 13, 14, 15]);
    await assert.rejects(opened.descriptor.write(Uint8Array.of(4), 0), error => Object.is(error, reason));
    assert.equal(host.resource.writes.length, 1);
  });

  for (const reason of [undefined, null, false, 0, ""]) test(`${route.name} close failure ${String(reason)} keeps accepted bytes charged and acknowledges once`, async () => {
    const host = fixture({ close: async () => { throw reason; } });
    const opened = await route.open(host);
    try {
      assert.equal(await opened.descriptor.write(Uint8Array.of(1, 2), 1), 2);
      await assert.rejects(opened.finish(), error => Object.is(error, reason));
      assert.equal(host.resource.charged, 2);
      assert.deepEqual(host.resource.bytes, [10, 1, 2, 13, 14, 15]);
      assert.deepEqual(await Promise.allSettled(host.cleanups.map(cleanup => cleanup())), [{ status: "rejected", reason }]);
      assert.equal(opened.descriptor.acknowledgeCloseFailure(reason), true);
      await Promise.all(host.cleanups.map(cleanup => cleanup()));
      await assert.rejects(opened.descriptor.write(Uint8Array.of(9), 0), { code: "EBADF" });
      assert.equal(host.resource.closes, 1);
      assert.equal(host.resource.charged, 2);
    } finally {
      await Promise.allSettled([opened.finish(), ...host.cleanups.map(cleanup => cleanup())]);
    }
  });

  test(`${route.name} ordinary close drains admitted positioned write without cancelling it`, { timeout: 2000 }, async context => {
    const entered = deferred();
    const release = deferred();
    const host = fixture({ beforeWrite: async () => { entered.resolve(); await release.promise; } });
    const opened = await route.open(host);
    context.after(async () => { release.resolve(); await opened.finish(); });
    const writing = opened.descriptor.write(Uint8Array.of(1, 2), 1);
    await entered.promise;
    const closing = opened.finish();
    await assert.rejects(opened.descriptor.write(Uint8Array.of(3), 0), { code: "EBADF" });
    assert.equal(host.resource.closes, 0);
    release.resolve();
    assert.equal(await writing, 2);
    await closing;
    assert.equal(host.resource.closes, 1);
    assert.equal(host.resource.charged, 2);
    assert.equal(host.resource.cursor, 2);
    assert.deepEqual(host.resource.bytes, [10, 1, 2, 13, 14, 15]);
  });
}

test("retained append output shares one cursor and counted ledger between positioned descriptor and sink writes", async context => {
  const host = fixture({ partial: 2, limit: 5 });
  const output = await openFileOutput(host.context, "/retained", { flag: "a", descriptor: true });
  context.after(() => output.finish());
  assert.equal(await output.descriptor!.write(Uint8Array.of(1, 2, 3), 0), 2);
  assert.equal(await output.descriptor!.getPosition!(), 2);
  await output.sink.write(Uint8Array.of(4, 5, 6));
  assert.equal(await output.descriptor!.getPosition!(), 9);
  assert.deepEqual(host.resource.bytes, [1, 2, 12, 13, 14, 15, 4, 5, 6]);
  assert.deepEqual(host.resource.writes.map(call => call.position), [0, null, null]);
  assert.equal(host.resource.charged, 5);
  await assert.rejects(output.descriptor!.write(Uint8Array.of(9), 0), { message: "fixture output quota" });
  assert.equal(host.resource.writes.length, 3);
});
