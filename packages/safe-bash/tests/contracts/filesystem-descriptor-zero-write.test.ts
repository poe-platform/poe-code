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
  positioned?: boolean;
  limit?: number;
  write?: (buffer: Uint8Array, position: number | null, options: FsOptions) => Promise<number>;
  close?: () => Promise<void>;
} = {}) {
  const memory = createMemoryFileSystem();
  const controller = new AbortController();
  const cleanups: InvocationCleanup[] = [];
  const advertised = Object.hasOwn(options, "advertised") ? options.advertised : true;
  const resource = {
    cursor: 2, bytes: [10, 20, 30], closes: 0, charged: 0, reservations: [] as number[],
    retainedCalls: [] as { buffer: Uint8Array; position: number | null }[], backendCalls: 0,
  };
  const fs: FileSystem = new Proxy(memory, { get(target, key) {
    if (key === "open") return async (_path: string, request: OpenFileOptions): Promise<FileDescriptor> => {
      assert.equal(cleanups.length, 1);
      const capabilities: FileDescriptor["capabilities"] & { readonly delegateZeroLengthWrite?: boolean } = {
        positionedRead: true, positionedWrite: (options.positioned ?? true) && !request.append,
        truncate: true, position: true, synchronization: "none",
        ...(advertised === undefined ? {} : { delegateZeroLengthWrite: advertised }),
      };
      let closed = false;
      return {
        capabilities: Object.freeze(capabilities),
        async getPosition() { return resource.cursor; },
        async stat() { return memory.stat("/"); },
        async read() { throw new Error("read is outside this zero-write fixture"); },
        async write(buffer, position, supplied = {}) {
          supplied.signal?.throwIfAborted();
          if (closed || request.access === "read") throw new FsError("EBADF", { syscall: "write" });
          resource.retainedCalls.push({ buffer, position });
          if (!(buffer instanceof Uint8Array)) throw new TypeError("bytes required");
          if (position !== null && (!Number.isSafeInteger(position) || position < 0 || !capabilities.positionedWrite)) throw new FsError("EINVAL", { syscall: "write" });
          if (buffer.length === 0 && advertised !== true) return 0;
          resource.backendCalls++;
          if (options.write) return options.write(buffer, position, supplied);
          if (buffer.length > 0) {
            const offset = position ?? (request.append ? resource.bytes.length : resource.cursor);
            assert.ok(offset + buffer.length <= 64);
            for (let index = 0; index < buffer.length; index++) resource.bytes[offset + index] = buffer[index]!;
            if (position === null) resource.cursor = offset + buffer.length;
          }
          return buffer.length;
        },
        async truncate() { throw new Error("truncate is outside this zero-write fixture"); },
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
    if (chunk.length > (options.limit ?? 4) - resource.charged) throw new Error("fixture quota");
    resource.reservations.push(chunk.length);
    resource.charged += chunk.length;
    const accepted = await write();
    resource.charged -= chunk.length - accepted;
    return accepted;
  });
  return { context, controller, cleanups, resource };
}

for (const advertised of [true, false, undefined]) {
  for (const access of ["read", "write", "readwrite"] as const) test(`zero-write capability is effective for flag=${advertised}, access=${access}`, async context => {
    const host = fixture({ advertised });
    const descriptor = await openCommandFile(host.context, "/retained", { access });
    context.after(() => descriptor.close());
    assert.equal(Reflect.get(descriptor.capabilities, "delegateZeroLengthWrite"), advertised === true ? access !== "read" : advertised);
    assert.equal(Object.hasOwn(descriptor.capabilities, "delegateZeroLengthWrite"), advertised !== undefined);
    if (access === "read") {
      await assert.rejects(descriptor.write(new Uint8Array(), null), { code: "EBADF" });
      assert.deepEqual(host.resource.reservations, []);
      assert.equal(host.resource.retainedCalls.length, 0);
      assert.equal(host.resource.backendCalls, 0);
    } else {
      assert.equal(await descriptor.write(new Uint8Array(), null), 0);
      assert.equal(host.resource.retainedCalls.length, 1);
      assert.equal(host.resource.backendCalls, advertised === true ? 1 : 0);
      assert.deepEqual(host.resource.reservations, [0]);
      assert.equal(host.resource.charged, 0);
    }
  });

  for (const flag of ["w", "a"] as const) test(`exposed output descriptor preserves zero-write capability flag=${advertised}, open=${flag}`, async context => {
    const host = fixture({ advertised });
    const output = await openFileOutput(host.context, "/retained", { flag, descriptor: true });
    context.after(() => output.finish());
    assert.equal(Reflect.get(output.descriptor!.capabilities, "delegateZeroLengthWrite"), advertised);
    assert.equal(Object.hasOwn(output.descriptor!.capabilities, "delegateZeroLengthWrite"), advertised !== undefined);
    assert.equal(await output.descriptor!.write(new Uint8Array(), null), 0);
    assert.equal(host.resource.retainedCalls.length, 1);
    assert.equal(host.resource.backendCalls, advertised === true ? 1 : 0);
    assert.deepEqual(host.resource.reservations, [0]);
    assert.equal(host.resource.cursor, 2);
    assert.deepEqual(host.resource.bytes, [10, 20, 30]);
  });
}

test("sequential zero-write delegation does not require positioned-write capability", async context => {
  const host = fixture({ positioned: false });
  const descriptor = await openCommandFile(host.context, "/retained", { access: "write", append: true });
  context.after(() => descriptor.close());
  assert.equal(descriptor.capabilities.positionedWrite, false);
  assert.equal(Reflect.get(descriptor.capabilities, "delegateZeroLengthWrite"), true);
  assert.equal(await descriptor.write(new Uint8Array(), null), 0);
  assert.equal(host.resource.backendCalls, 1);
  await assert.rejects(descriptor.write(new Uint8Array(), 0), { code: "EINVAL" });
  assert.equal(host.resource.backendCalls, 1);
  assert.equal(host.resource.charged, 0);
});

const routes = [
  { name: "command", async open(host: ReturnType<typeof fixture>) {
    const descriptor = await openCommandFile(host.context, "/retained", { access: "write" });
    return { descriptor, finish: descriptor.close };
  } },
  { name: "output descriptor", async open(host: ReturnType<typeof fixture>) {
    const output = await openFileOutput(host.context, "/retained", { flag: "w", descriptor: true });
    return { descriptor: output.descriptor!, finish: () => output.finish() };
  } },
];

for (const route of routes) {
  test(`${route.name} forwards each explicit empty write once at zero remaining quota`, async context => {
    const host = fixture({ limit: 0 });
    const opened = await route.open(host);
    context.after(opened.finish);
    const empty = new Uint8Array();
    assert.equal(await opened.descriptor.write(empty, null), 0);
    assert.equal(await opened.descriptor.write(empty, 9), 0);
    assert.equal(host.resource.retainedCalls[0]!.buffer, empty);
    assert.equal(host.resource.retainedCalls[1]!.buffer, empty);
    assert.deepEqual(host.resource.retainedCalls.map(call => call.position), [null, 9]);
    assert.equal(host.resource.backendCalls, 2);
    assert.deepEqual(host.resource.reservations, [0, 0]);
    assert.equal(host.resource.charged, 0);
    assert.equal(await opened.descriptor.getPosition!(), 2);
    assert.deepEqual(host.resource.bytes, [10, 20, 30]);
    await assert.rejects(opened.descriptor.write(Uint8Array.of(1), null), { message: "fixture quota" });
    assert.equal(host.resource.backendCalls, 2);
  });

  for (const position of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) test(`${route.name} validates empty-write offset ${position} before backend delegation`, async context => {
    const host = fixture();
    const opened = await route.open(host);
    context.after(opened.finish);
    await assert.rejects(opened.descriptor.write(new Uint8Array(), position), { code: "EINVAL" });
    assert.equal(host.resource.backendCalls, 0);
    assert.deepEqual(host.resource.reservations, [0]);
    assert.equal(host.resource.charged, 0);
  });

  for (const count of [-1, 1, 0.5, NaN, Infinity]) test(`${route.name} rejects invalid zero-write count ${count} without negative quota`, async context => {
    const host = fixture({ write: async () => count });
    const opened = await route.open(host);
    context.after(opened.finish);
    await assert.rejects(opened.descriptor.write(new Uint8Array(), null), { code: "EIO" });
    assert.equal(host.resource.backendCalls, 1);
    assert.deepEqual(host.resource.reservations, [0]);
    assert.equal(host.resource.charged, 0);
    assert.equal(await opened.descriptor.getPosition!(), 2);
    assert.deepEqual(host.resource.bytes, [10, 20, 30]);
  });

  for (const reason of [undefined, null, false, 0, "", new FsError("ENOSPC"), new FsError("EIO"), new FsError("EPIPE")]) test(`${route.name} retains empty-write backend failure ${String(reason)} without masking or byte charges`, async context => {
    let fail = true;
    const host = fixture({ write: async () => { if (fail) throw reason; return 0; } });
    const opened = await route.open(host);
    context.after(opened.finish);
    await assert.rejects(opened.descriptor.write(new Uint8Array(), null), error => Object.is(error, reason));
    assert.equal(host.resource.backendCalls, 1);
    assert.equal(host.resource.charged, 0);
    fail = false;
    assert.equal(await opened.descriptor.write(new Uint8Array(), null), 0);
    assert.equal(host.resource.backendCalls, 2);
    assert.deepEqual(host.resource.reservations, [0, 0]);
  });

  for (const reason of [null, false, 0, ""]) test(`${route.name} preadmission cancellation ${String(reason)} prevents empty delegation and reservation`, async context => {
    const host = fixture();
    const opened = await route.open(host);
    context.after(opened.finish);
    const local = new AbortController();
    local.abort(reason);
    let gets = 0;
    await assert.rejects(opened.descriptor.write(new Uint8Array(), null, { get signal() { gets++; return local.signal; } }), error => Object.is(error, reason));
    assert.equal(gets, 1);
    assert.equal(host.resource.backendCalls, 0);
    assert.deepEqual(host.resource.reservations, []);
    assert.equal(await opened.descriptor.write(new Uint8Array(), null), 0);
    assert.equal(host.resource.backendCalls, 1);
  });

  for (const reason of [null, false, 0, ""]) test(`${route.name} queued cancellation ${String(reason)} cannot spill into another zero write`, { timeout: 2000 }, async context => {
    const entered = deferred();
    const release = deferred();
    const host = fixture({ write: async () => { entered.resolve(); await release.promise; return 0; } });
    const opened = await route.open(host);
    context.after(async () => { release.resolve(); await opened.finish(); });
    const first = opened.descriptor.write(new Uint8Array(), null);
    await entered.promise;
    const local = new AbortController();
    const rejected = assert.rejects(opened.descriptor.write(new Uint8Array(), null, { signal: local.signal }), error => Object.is(error, reason));
    const peer = opened.descriptor.write(new Uint8Array(), null);
    local.abort(reason);
    release.resolve();
    assert.equal(await first, 0);
    await rejected;
    assert.equal(await peer, 0);
    assert.equal(host.resource.backendCalls, 2);
    assert.deepEqual(host.resource.reservations, [0, 0]);
    assert.equal(host.controller.signal.aborted, false);
  });

  for (const reason of [null, false, 0, ""]) test(`${route.name} root cancellation ${String(reason)} joins admitted empty backend work`, { timeout: 2000 }, async context => {
    const entered = deferred();
    const release = deferred();
    const host = fixture({ write: async (_buffer, _position, supplied) => {
      entered.resolve();
      await release.promise;
      supplied.signal?.throwIfAborted();
      return 0;
    } });
    const opened = await route.open(host);
    context.after(async () => { release.resolve(); await Promise.allSettled([opened.finish(), ...host.cleanups.map(cleanup => cleanup())]); });
    const rejected = assert.rejects(opened.descriptor.write(new Uint8Array(), null), error => Object.is(error, reason));
    await entered.promise;
    host.controller.abort(reason);
    assert.equal(host.resource.closes, 0);
    release.resolve();
    await rejected;
    await Promise.allSettled([opened.finish(), ...host.cleanups.map(cleanup => cleanup())]);
    assert.equal(host.resource.closes, 1);
    assert.equal(host.resource.backendCalls, 1);
    assert.equal(host.resource.charged, 0);
    await assert.rejects(opened.descriptor.write(new Uint8Array(), null), error => Object.is(error, reason));
    assert.equal(host.resource.backendCalls, 1);
  });

  test(`${route.name} close seals admission but drains an already admitted zero write`, { timeout: 2000 }, async context => {
    const entered = deferred();
    const release = deferred();
    const host = fixture({ write: async () => { entered.resolve(); await release.promise; return 0; } });
    const opened = await route.open(host);
    context.after(async () => { release.resolve(); await opened.finish(); });
    const writing = opened.descriptor.write(new Uint8Array(), null);
    await entered.promise;
    const closing = opened.finish();
    await assert.rejects(opened.descriptor.write(new Uint8Array(), null), { code: "EBADF" });
    assert.equal(host.resource.closes, 0);
    release.resolve();
    assert.equal(await writing, 0);
    await closing;
    assert.equal(host.resource.closes, 1);
    assert.equal(host.resource.backendCalls, 1);
    assert.deepEqual(host.resource.reservations, [0]);
  });

  for (const reason of [undefined, null, false, 0, ""]) test(`${route.name} empty-write success does not hide close failure ${String(reason)}`, async () => {
    const host = fixture({ close: async () => { throw reason; } });
    const opened = await route.open(host);
    try {
      assert.equal(await opened.descriptor.write(new Uint8Array(), null), 0);
      await assert.rejects(opened.finish(), error => Object.is(error, reason));
      assert.deepEqual(await Promise.allSettled(host.cleanups.map(cleanup => cleanup())), [{ status: "rejected", reason }]);
      assert.equal(opened.descriptor.acknowledgeCloseFailure(reason), true);
      await Promise.all(host.cleanups.map(cleanup => cleanup()));
      assert.equal(host.resource.backendCalls, 1);
      assert.equal(host.resource.closes, 1);
      assert.equal(host.resource.charged, 0);
    } finally {
      await Promise.allSettled([opened.finish(), ...host.cleanups.map(cleanup => cleanup())]);
    }
  });
}
