import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, openFileDescriptor, type DescriptorBackend, type FileDescriptor, type FileSystem, type FsOptions, type OpenFileOptions } from "poe-code/safe-fs";
import type { InvocationCleanup } from "../../src/contracts/command.js";
import { bindFileOutputBudget, openFileOutput, type FileOutput } from "../../src/contracts/filesystem-output.js";

function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(options: {
  advertised?: boolean | undefined;
  probe?: (options: FsOptions) => Promise<"ready" | "blocked" | "unknown">;
  close?: () => Promise<void>;
  decorate?: (descriptor: FileDescriptor) => void;
} = {}) {
  const backing = createMemoryFileSystem();
  const controller = new AbortController();
  const cleanups: InvocationCleanup[] = [];
  const events: string[] = [];
  const resource = { position: 0, bytes: [] as number[], closes: 0, probes: 0, charged: 0 };
  const capabilities = {
    positionedRead: true, positionedWrite: true, truncate: true, position: true,
    synchronization: "none" as const,
    ...(Object.hasOwn(options, "advertised") ? options.advertised === undefined ? {} : { readObservation: options.advertised } : { readObservation: true }),
  };
  const backend: DescriptorBackend<typeof resource> = {
    resource,
    async probeRead(retained, supplied) {
      assert.equal(this, backend);
      assert.equal(retained, resource);
      resource.probes++;
      events.push("probe");
      return options.probe ? options.probe(supplied) : "ready";
    },
    async getPosition() { return resource.position; },
    async stat() { events.push("stat"); return backing.stat("/"); },
    async read() { throw new Error("write-only observation cannot read"); },
    async write(_retained, buffer) {
      events.push("write");
      resource.bytes.push(...buffer);
      resource.position += buffer.length;
      return buffer.length;
    },
    async truncate() { throw new Error("observation cannot truncate"); },
    async sync() { events.push("sync"); },
    async close() { resource.closes++; events.push("close"); await options.close?.(); },
  };
  const fs: FileSystem = new Proxy(backing, { get(target, key) {
    if (key === "open") return async (path: string, supplied: OpenFileOptions) => {
      assert.equal(cleanups.length, 1);
      assert.equal(supplied.access, "write");
      const descriptor = await openFileDescriptor(path, supplied, capabilities, async () => backend);
      options.decorate?.(descriptor);
      return descriptor;
    };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const context = { fs, signal: controller.signal, registerCleanup: (cleanup: InvocationCleanup) => { cleanups.push(cleanup); } };
  bindFileOutputBudget(context, sink => sink, async (chunk, write) => { resource.charged += chunk.length; return write(); });
  return { context, controller, cleanups, resource, events };
}

for (const readiness of ["ready", "blocked", "unknown"] as const) test(`output retained write-only descriptor propagates ${readiness} without charging or consuming`, async context => {
  const host = fixture({ probe: async () => readiness });
  const output = await openFileOutput(host.context, "/out", { flag: "w", descriptor: true });
  context.after(() => output.finish());
  assert.equal(output.descriptor!.capabilities.readObservation, true);
  assert.equal(typeof output.descriptor!.probeRead, "function");
  assert.equal(await output.descriptor!.probeRead!(), readiness);
  assert.equal(await output.descriptor!.getPosition!(), 0);
  assert.equal(host.resource.charged, 0);
  assert.deepEqual(host.resource.bytes, []);
  assert.deepEqual(host.events, ["probe"]);
  await assert.rejects(output.descriptor!.read(new Uint8Array(1), null), { code: "EBADF" });
  await output.sink.write(Uint8Array.of(0, 255, 3));
  assert.equal(await output.descriptor!.probeRead!(), readiness);
  assert.equal(host.resource.charged, 3);
  assert.deepEqual(host.resource.bytes, [0, 255, 3]);
});

test("output propagates the once-captured canonical receiver rather than reacquiring a method", async context => {
  let gets = 0;
  let retained!: FileDescriptor;
  const host = fixture({ decorate(descriptor) {
    retained = descriptor;
    const original = descriptor.probeRead!;
    Object.defineProperty(descriptor, "probeRead", { configurable: true, get() {
      gets++;
      return function(this: FileDescriptor, options?: FsOptions) {
        assert.equal(this, retained);
        return original.call(this, options);
      };
    } });
  } });
  const output = await openFileOutput(host.context, "/out", { flag: "w", descriptor: true });
  context.after(() => output.finish());
  assert.equal(gets, 1);
  Object.defineProperty(retained, "probeRead", { get() { throw new Error("captured method only"); } });
  assert.equal(await output.descriptor!.probeRead!(), "ready");
  assert.equal(gets, 1);
});

for (const advertised of [false, undefined]) test(`output neither accesses nor promotes unadvertised getter ${advertised}`, async context => {
  let gets = 0;
  const host = fixture({ advertised, decorate(descriptor) {
    Object.defineProperty(descriptor, "probeRead", { get() { gets++; throw new Error("unadvertised getter"); } });
  } });
  const output = await openFileOutput(host.context, "/out", { flag: "w", descriptor: true });
  context.after(() => output.finish());
  assert.equal(output.descriptor!.capabilities.readObservation, advertised);
  assert.equal(output.descriptor!.probeRead, undefined);
  assert.equal(gets, 0);
});

test("output refuses advertised missing method and drains acquisition exactly once", async () => {
  const host = fixture({ decorate(descriptor) { Object.defineProperty(descriptor, "probeRead", { value: undefined }); } });
  try {
    await assert.rejects(openFileOutput(host.context, "/out", { flag: "w", descriptor: true }), { code: "ENOTSUP", syscall: "probeRead" });
  } finally {
    await Promise.all(host.cleanups.map(cleanup => cleanup()));
  }
  assert.equal(host.resource.closes, 1);
  assert.equal(host.resource.charged, 0);
});

for (const reason of [undefined, null, false, 0, ""]) test(`output preserves advertised getter failure and drains acquisition ${String(reason)}`, async () => {
  const host = fixture({ decorate(descriptor) {
    Object.defineProperty(descriptor, "probeRead", { get() { throw reason; } });
  } });
  try {
    await assert.rejects(openFileOutput(host.context, "/out", { flag: "w", descriptor: true }), error => Object.is(error, reason));
  } finally {
    await Promise.allSettled(host.cleanups.map(cleanup => cleanup()));
  }
  assert.equal(host.resource.closes, 1);
  assert.equal(host.resource.charged, 0);
});

for (const invalid of [undefined, false, "READY", {}]) test(`output rejects invalid raw observation ${JSON.stringify(invalid)}`, async context => {
  const host = fixture({ decorate(descriptor) { Object.defineProperty(descriptor, "probeRead", { value: async () => invalid }); } });
  const output = await openFileOutput(host.context, "/out", { flag: "w", descriptor: true });
  context.after(() => output.finish());
  assert.equal(typeof output.descriptor!.probeRead, "function");
  await assert.rejects(output.descriptor!.probeRead!(), { code: "EIO", syscall: "probeRead" });
  assert.equal(host.resource.charged, 0);
});

for (const reason of [undefined, null, false, 0, ""]) test(`output preserves exact query failure without retiring the sink ${String(reason)}`, async context => {
  const host = fixture({ probe: async () => { throw reason; } });
  const output = await openFileOutput(host.context, "/out", { flag: "w", descriptor: true });
  context.after(() => output.finish());
  assert.equal(typeof output.descriptor!.probeRead, "function");
  await assert.rejects(output.descriptor!.probeRead!(), error => Object.is(error, reason));
  await output.sink.write(Uint8Array.of(6));
  assert.deepEqual(host.resource.bytes, [6]);
  assert.equal(host.resource.charged, 1);
});

for (const reason of [null, false, 0, ""]) test(`output observation captures cancelled local signal once without cancelling sink ${String(reason)}`, async context => {
  const host = fixture();
  const output = await openFileOutput(host.context, "/out", { flag: "w", descriptor: true });
  context.after(() => output.finish());
  const local = new AbortController();
  local.abort(reason);
  let gets = 0;
  assert.equal(typeof output.descriptor!.probeRead, "function");
  await assert.rejects(output.descriptor!.probeRead!({ get signal() { gets++; return local.signal; } }), error => Object.is(error, reason));
  assert.equal(gets, 1);
  assert.equal(host.resource.probes, 0);
  await output.sink.write(Uint8Array.of(7));
  assert.equal(await output.descriptor!.probeRead!(), "ready");
  assert.equal(host.resource.charged, 1);
});

for (const retirement of ["finish", "close"] as const) test(`output ${retirement} seals observation admission and drains admitted sink work`, { timeout: 2000 }, async context => {
  const entered = deferred();
  const release = deferred();
  const host = fixture({ probe: async () => { entered.resolve(); await release.promise; return "blocked"; } });
  const output = await openFileOutput(host.context, "/out", { flag: "w", descriptor: true });
  context.after(async () => { release.resolve(); await output.finish(); });
  assert.equal(typeof output.descriptor!.probeRead, "function");
  const probing = output.descriptor!.probeRead!();
  await entered.promise;
  const writing = output.sink.write(Uint8Array.of(1, 2));
  const closing = retirement === "finish" ? output.finish() : output.descriptor!.close();
  await assert.rejects(output.descriptor!.probeRead!(), { code: "EBADF" });
  assert.deepEqual(host.events, ["probe"]);
  release.resolve();
  assert.equal(await probing, "blocked");
  await writing;
  await closing;
  assert.deepEqual(host.events, ["probe", "write", "close"]);
  assert.equal(host.resource.charged, 2);
  assert.equal(host.resource.closes, 1);
});

test("output reentrant finish from an observation joins that observation", { timeout: 2000 }, async context => {
  let finishing: Promise<void> | undefined;
  const host = fixture({ probe: async () => { finishing = output.finish(); return "unknown"; } });
  const output: FileOutput = await openFileOutput(host.context, "/out", { flag: "w", descriptor: true });
  context.after(() => output.finish());
  assert.equal(typeof output.descriptor!.probeRead, "function");
  assert.equal(await output.descriptor!.probeRead!(), "unknown");
  assert.ok(finishing);
  await finishing;
  assert.equal(host.resource.closes, 1);
  await assert.rejects(output.descriptor!.probeRead!(), { code: "EBADF" });
});

for (const reason of [null, false, 0, ""]) test(`output queued observation cancellation does not spill into sink writes ${String(reason)}`, { timeout: 2000 }, async context => {
  const entered = deferred();
  const release = deferred();
  const host = fixture({ probe: async () => { entered.resolve(); await release.promise; return "ready"; } });
  const output = await openFileOutput(host.context, "/out", { flag: "w", descriptor: true });
  context.after(async () => { release.resolve(); await output.finish(); });
  assert.equal(typeof output.descriptor!.probeRead, "function");
  const probing = output.descriptor!.probeRead!();
  await entered.promise;
  const local = new AbortController();
  const rejected = assert.rejects(output.descriptor!.probeRead!({ signal: local.signal }), error => Object.is(error, reason));
  const writing = output.sink.write(Uint8Array.of(9));
  local.abort(reason);
  release.resolve();
  assert.equal(await probing, "ready");
  await rejected;
  await writing;
  assert.equal(host.resource.probes, 1);
  assert.equal(host.resource.charged, 1);
  assert.deepEqual(host.resource.bytes, [9]);
});

for (const reason of [null, false, 0, ""]) test(`output abort seals observations while draining an active query ${String(reason)}`, { timeout: 2000 }, async context => {
  const entered = deferred();
  const release = deferred();
  const host = fixture({ probe: async supplied => {
    entered.resolve();
    await release.promise;
    supplied.signal?.throwIfAborted();
    return "ready";
  } });
  const output = await openFileOutput(host.context, "/out", { flag: "w", descriptor: true });
  context.after(async () => { release.resolve(); await Promise.allSettled([output.finish(), ...host.cleanups.map(cleanup => cleanup())]); });
  assert.equal(typeof output.descriptor!.probeRead, "function");
  const rejected = assert.rejects(output.descriptor!.probeRead!(), error => Object.is(error, reason));
  await entered.promise;
  const aborting = output.abort(reason);
  await assert.rejects(output.descriptor!.probeRead!(), error => Object.is(error, reason));
  assert.equal(host.resource.closes, 0);
  release.resolve();
  await rejected;
  await aborting;
  assert.equal(host.resource.closes, 1);
  assert.equal(host.resource.charged, 0);
  assert.equal(host.controller.signal.aborted, false);
});

for (const reason of [undefined, null, false, 0, ""]) test(`output observation cannot bypass close failure acknowledgement ${String(reason)}`, async () => {
  const host = fixture({ close: async () => { throw reason; } });
  const output = await openFileOutput(host.context, "/out", { flag: "w", descriptor: true });
  try {
    assert.equal(typeof output.descriptor!.probeRead, "function");
    assert.equal(await output.descriptor!.probeRead!(), "ready");
    await assert.rejects(output.finish(), error => Object.is(error, reason));
    await assert.rejects(output.descriptor!.probeRead!(), { code: "EBADF" });
    assert.deepEqual(await Promise.allSettled(host.cleanups.map(cleanup => cleanup())), [{ status: "rejected", reason }]);
    assert.equal(output.descriptor!.acknowledgeCloseFailure(reason), true);
    assert.deepEqual(await Promise.allSettled(host.cleanups.map(cleanup => cleanup())), [{ status: "fulfilled", value: undefined }]);
    assert.equal(host.resource.closes, 1);
  } finally {
    await Promise.allSettled([output.finish(), ...host.cleanups.map(cleanup => cleanup())]);
  }
});

for (const reason of [null, false, 0, ""]) test(`output caller cancellation drains admitted query and keeps exact priority ${String(reason)}`, { timeout: 2000 }, async context => {
  const entered = deferred();
  const release = deferred();
  const host = fixture({ probe: async supplied => {
    entered.resolve();
    await release.promise;
    supplied.signal?.throwIfAborted();
    return "ready";
  } });
  const output = await openFileOutput(host.context, "/out", { flag: "w", descriptor: true });
  context.after(async () => { release.resolve(); await Promise.allSettled([output.finish(), ...host.cleanups.map(cleanup => cleanup())]); });
  assert.equal(typeof output.descriptor!.probeRead, "function");
  const rejected = assert.rejects(output.descriptor!.probeRead!(), error => Object.is(error, reason));
  await entered.promise;
  host.controller.abort(reason);
  assert.equal(host.resource.closes, 0);
  release.resolve();
  await rejected;
  await assert.rejects(output.finish(), error => Object.is(error, reason));
  assert.equal(host.resource.closes, 1);
  await assert.rejects(output.descriptor!.probeRead!(), error => Object.is(error, reason));
});
