import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, openFileDescriptor, type DescriptorBackend, type FileDescriptor, type FileSystem, type FsOptions } from "poe-code/safe-fs";
import type { InvocationCleanup } from "../../src/contracts/command.js";
import { openCommandFile, type CommandFileDescriptor } from "../../src/contracts/filesystem-descriptor.js";
import { bindFileOutputBudget } from "../../src/contracts/filesystem-output.js";

type Readiness = "ready" | "blocked" | "unknown";

function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(options: {
  advertised?: boolean | undefined;
  probe?: (options: FsOptions) => Promise<Readiness>;
  decorate?: (descriptor: FileDescriptor) => void;
  close?: () => Promise<void>;
} = {}) {
  const backing = createMemoryFileSystem();
  const controller = new AbortController();
  const cleanups: InvocationCleanup[] = [];
  const events: string[] = [];
  const resource = { position: 3, bytes: Uint8Array.of(0, 255, 4), probes: 0, closes: 0, charges: 0 };
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
    async read() { events.push("read"); throw new Error("observation must not read"); },
    async write() { events.push("write"); throw new Error("observation must not write"); },
    async truncate() { events.push("truncate"); throw new Error("observation must not truncate"); },
    async sync() { events.push("sync"); },
    async close() { resource.closes++; events.push("close"); await options.close?.(); },
  };
  const fs: FileSystem = new Proxy(backing, { get(target, key) {
    if (key === "open") return async (path: string, supplied: Parameters<typeof openCommandFile>[2]) => {
      assert.equal(cleanups.length, 1);
      const descriptor = await openFileDescriptor(path, supplied, capabilities, async () => backend);
      options.decorate?.(descriptor);
      return descriptor;
    };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const context = { fs, signal: controller.signal, registerCleanup: (cleanup: InvocationCleanup) => { cleanups.push(cleanup); } };
  bindFileOutputBudget(context, sink => sink, async (_chunk, write) => { resource.charges++; return write(); });
  return { context, controller, resource, events, cleanups };
}

for (const access of ["read", "write", "readwrite"] as const) {
  for (const readiness of ["ready", "blocked", "unknown"] as const) {
    test(`command ${access} descriptor preserves ${readiness} without IO or byte charging`, async context => {
      const host = fixture({ probe: async () => readiness });
      const descriptor = await openCommandFile(host.context, "/retained", { access });
      context.after(() => descriptor.close());
      assert.equal(descriptor.capabilities.readObservation, true);
      assert.equal(typeof descriptor.probeRead, "function");
      assert.equal(await descriptor.probeRead!(), readiness);
      assert.equal(await descriptor.getPosition!(), 3);
      assert.deepEqual(host.events, ["probe"]);
      assert.deepEqual(host.resource.bytes, Uint8Array.of(0, 255, 4));
      assert.equal(host.resource.charges, 0);
      if (access === "write") await assert.rejects(descriptor.read(new Uint8Array(1), null), { code: "EBADF" });
    });
  }
}

test("command captures the advertised method once with its retained receiver", async context => {
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
  const descriptor = await openCommandFile(host.context, "/retained", { access: "read" });
  context.after(() => descriptor.close());
  assert.equal(gets, 1);
  Object.defineProperty(retained, "probeRead", { get() { throw new Error("method must be captured"); } });
  assert.equal(await descriptor.probeRead!(), "ready");
  assert.equal(await descriptor.probeRead!(), "ready");
  assert.equal(gets, 1);
});

for (const advertised of [false, undefined]) test(`command does not inspect or promote unadvertised observation ${advertised}`, async context => {
  let gets = 0;
  const host = fixture({ advertised, decorate(descriptor) {
    Object.defineProperty(descriptor, "probeRead", { get() { gets++; throw new Error("unadvertised getter"); } });
  } });
  const descriptor = await openCommandFile(host.context, "/retained", { access: "read" });
  context.after(() => descriptor.close());
  assert.equal(descriptor.capabilities.readObservation, advertised);
  assert.equal(descriptor.probeRead, undefined);
  assert.equal(gets, 0);
});

for (const method of [undefined, null, false, 1]) test(`command refuses advertised noncallable ${String(method)} and closes once`, async () => {
  const host = fixture({ decorate(descriptor) { Object.defineProperty(descriptor, "probeRead", { value: method }); } });
  try {
    await assert.rejects(openCommandFile(host.context, "/retained", { access: "read" }), { code: "ENOTSUP", syscall: "probeRead" });
  } finally {
    await Promise.all(host.cleanups.map(cleanup => cleanup()));
  }
  assert.equal(host.resource.closes, 1);
});

for (const reason of [undefined, null, false, 0, ""]) test(`command drains acquisition after advertised getter throws ${String(reason)}`, async () => {
  const host = fixture({ decorate(descriptor) {
    Object.defineProperty(descriptor, "probeRead", { get() { throw reason; } });
  } });
  try {
    await assert.rejects(openCommandFile(host.context, "/retained", { access: "read" }), error => Object.is(error, reason));
  } finally {
    await Promise.all(host.cleanups.map(cleanup => cleanup()));
  }
  assert.equal(host.resource.closes, 1);
});

for (const invalid of [undefined, null, false, 0, "READY", "", {}, ["ready"]]) test(`command validates raw provider observation result ${JSON.stringify(invalid)}`, async context => {
  const host = fixture({ decorate(descriptor) {
    Object.defineProperty(descriptor, "probeRead", { value: async () => invalid });
  } });
  const descriptor = await openCommandFile(host.context, "/retained", { access: "read" });
  context.after(() => descriptor.close());
  assert.equal(typeof descriptor.probeRead, "function");
  await assert.rejects(descriptor.probeRead!(), { code: "EIO", syscall: "probeRead" });
});

for (const reason of [undefined, null, false, 0, ""]) test(`command preserves exact probe rejection ${String(reason)} without poisoning the queue`, async context => {
  let fail = true;
  const host = fixture({ probe: async () => { if (fail) throw reason; return "blocked"; } });
  const descriptor = await openCommandFile(host.context, "/retained", { access: "read" });
  context.after(() => descriptor.close());
  assert.equal(typeof descriptor.probeRead, "function");
  await assert.rejects(descriptor.probeRead!(), error => Object.is(error, reason));
  fail = false;
  assert.equal(await descriptor.probeRead!(), "blocked");
});

for (const reason of [null, false, 0, ""]) test(`command captures forwarded cancellation once and isolates it ${String(reason)}`, async context => {
  const host = fixture();
  const descriptor = await openCommandFile(host.context, "/retained", { access: "read" });
  context.after(() => descriptor.close());
  const local = new AbortController();
  local.abort(reason);
  let gets = 0;
  assert.equal(typeof descriptor.probeRead, "function");
  await assert.rejects(descriptor.probeRead!({ get signal() { gets++; return local.signal; } }), error => Object.is(error, reason));
  assert.equal(gets, 1);
  assert.equal(host.resource.probes, 0);
  assert.equal(await descriptor.probeRead!(), "ready");
});

test("command serializes observations with stat and drains admitted work before close", { timeout: 2000 }, async context => {
  const entered = deferred();
  const release = deferred();
  const host = fixture({ probe: async () => { entered.resolve(); await release.promise; return "blocked"; } });
  const descriptor = await openCommandFile(host.context, "/retained", { access: "read" });
  context.after(async () => { release.resolve(); await descriptor.close(); });
  assert.equal(typeof descriptor.probeRead, "function");
  const probing = descriptor.probeRead!();
  await entered.promise;
  const statting = descriptor.stat();
  const closing = descriptor.close();
  assert.equal(descriptor.close(), closing);
  await assert.rejects(descriptor.probeRead!(), { code: "EBADF" });
  assert.deepEqual(host.events, ["probe"]);
  release.resolve();
  assert.equal(await probing, "blocked");
  await statting;
  await closing;
  assert.deepEqual(host.events, ["probe", "stat", "close"]);
  assert.equal(host.resource.closes, 1);
});

test("command reentrant close admission drains the current observation", { timeout: 2000 }, async context => {
  let closing: Promise<void> | undefined;
  const host = fixture({ probe: async () => { closing = descriptor.close(); return "unknown"; } });
  const descriptor: CommandFileDescriptor = await openCommandFile(host.context, "/retained", { access: "read" });
  context.after(() => descriptor.close());
  assert.equal(typeof descriptor.probeRead, "function");
  assert.equal(await descriptor.probeRead!(), "unknown");
  assert.ok(closing);
  await closing;
  assert.deepEqual(host.events, ["probe", "close"]);
  await assert.rejects(descriptor.probeRead!(), { code: "EBADF" });
});

for (const reason of [null, false, 0, ""]) test(`command queued probe cancellation does not affect an admitted peer ${String(reason)}`, { timeout: 2000 }, async context => {
  const entered = deferred();
  const release = deferred();
  const host = fixture({ probe: async () => { entered.resolve(); await release.promise; return "ready"; } });
  const descriptor = await openCommandFile(host.context, "/retained", { access: "read" });
  context.after(async () => { release.resolve(); await descriptor.close(); });
  assert.equal(typeof descriptor.probeRead, "function");
  const first = descriptor.probeRead!();
  await entered.promise;
  const local = new AbortController();
  const rejected = assert.rejects(descriptor.probeRead!({ signal: local.signal }), error => Object.is(error, reason));
  const peer = descriptor.probeRead!();
  local.abort(reason);
  release.resolve();
  assert.equal(await first, "ready");
  await rejected;
  assert.equal(await peer, "ready");
  assert.equal(host.resource.probes, 2);
  assert.equal(host.resource.closes, 0);
});

for (const reason of [null, false, 0, ""]) test(`command caller cancellation drains active observation ${String(reason)}`, { timeout: 2000 }, async context => {
  const entered = deferred();
  const release = deferred();
  const host = fixture({ probe: async supplied => {
    entered.resolve();
    await release.promise;
    supplied.signal?.throwIfAborted();
    return "ready";
  } });
  const descriptor = await openCommandFile(host.context, "/retained", { access: "read" });
  context.after(async () => { release.resolve(); await descriptor.close(); });
  assert.equal(typeof descriptor.probeRead, "function");
  const probing = descriptor.probeRead!();
  const rejected = assert.rejects(probing, error => Object.is(error, reason));
  await entered.promise;
  host.controller.abort(reason);
  const closing = descriptor.close();
  assert.equal(host.resource.closes, 0);
  release.resolve();
  await rejected;
  await closing;
  assert.equal(host.resource.closes, 1);
  await assert.rejects(descriptor.probeRead!(), error => Object.is(error, reason));
});
