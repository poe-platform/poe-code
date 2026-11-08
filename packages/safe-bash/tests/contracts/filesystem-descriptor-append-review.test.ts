import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, FsError, type FileDescriptor, type FileDescriptorCapabilities, type OpenFileOptions } from "poe-code/safe-fs";
import type { InvocationCleanup } from "../../src/contracts/command.js";
import { openCommandFile } from "../../src/contracts/filesystem-descriptor.js";
import { bindFileOutputBudget } from "../../src/contracts/filesystem-output-budget.js";

function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(accept => { resolve = accept; });
  return { promise, resolve };
}

function fixture(flag: boolean | undefined, base = true) {
  const controller = new AbortController();
  const cleanups: InvocationCleanup[] = [];
  const resource = { bytes: [10, 20, 30], cursor: 1, closes: 0, opens: 0, charged: 0 };
  const positions: (number | null)[] = [];
  const capabilities: FileDescriptorCapabilities = {
    position: true, readObservation: true, positionedRead: true, positionedWrite: base,
    truncate: false, synchronization: "none",
    ...(flag === undefined ? {} : { positionedAppendWrite: flag }),
  };
  const source: FileDescriptor = {
    capabilities,
    async getPosition() { assert.equal(this, source); return resource.cursor; },
    async probeRead() { assert.equal(this, source); return "blocked"; },
    async stat() { return { type: "file", size: resource.bytes.length, mode: 0o100600, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 }; },
    async read() { throw new Error("unexpected read"); },
    async write(bytes, position) {
      assert.equal(this, source);
      assert.equal(resource.closes, 0);
      if (position !== null && !(base && flag === true)) throw new FsError("EINVAL", { syscall: "write" });
      positions.push(position);
      const count = Math.min(bytes.length, 2);
      const offset = position ?? resource.bytes.length;
      resource.bytes.splice(offset, count, ...bytes.subarray(0, count));
      if (position === null) resource.cursor = offset + count;
      return count;
    },
    async truncate() { throw new Error("unexpected truncate"); },
    async sync() { throw new Error("unexpected sync"); },
    async close() { assert.equal(this, source); resource.closes++; },
  };
  const filesystem = createMemoryFileSystem();
  Object.defineProperty(filesystem, "open", { configurable: true, value: async (_path: string, options: OpenFileOptions) => {
    assert.equal(cleanups.length, 1);
    assert.equal(options.append, true);
    resource.opens++;
    return source;
  } });
  const context = { fs: filesystem, signal: controller.signal, registerCleanup(cleanup: InvocationCleanup) { cleanups.push(cleanup); } };
  bindFileOutputBudget(context, sink => sink, async (bytes, write) => {
    resource.charged += bytes.length;
    const count = await write();
    resource.charged -= bytes.length - count;
    return count;
  });
  return { context, controller, cleanups, resource, positions, capabilities, source };
}

for (const flag of [undefined, false, true]) {
  for (const base of [false, true]) {
    test(`append helper review: flag=${flag} base=${base} keeps omission and requires writable access`, async () => {
      for (const access of ["read", "write", "readwrite"] as const) {
        const subject = fixture(flag, base);
        const descriptor = await openCommandFile(subject.context, "/borrowed", { access, append: true });
        try {
          const effective = flag === true && base && access !== "read";
          assert.equal(descriptor.capabilities.positionedWrite, effective);
          assert.equal(descriptor.capabilities.positionedAppendWrite, flag === undefined ? undefined : effective);
          assert.equal(Object.hasOwn(descriptor.capabilities, "positionedAppendWrite"), flag !== undefined);
          assert.equal(Object.isFrozen(descriptor.capabilities), true);
          if (access === "read") {
            await assert.rejects(descriptor.write(Uint8Array.of(99), 0), { code: "EBADF" });
            assert.equal(subject.resource.charged, 0);
            assert.deepEqual(subject.positions, []);
          }
        } finally { await descriptor.close(); }
        await Promise.all(subject.cleanups.map(cleanup => cleanup()));
        assert.equal(subject.resource.closes, 1);
      }
    });
  }
}

test("append helper review: retains the borrowed receiver and captured observation after the filesystem open changes", async () => {
  const subject = fixture(true);
  let getterReads = 0;
  const originalProbe = subject.source.probeRead!;
  Object.defineProperty(subject.source, "probeRead", { configurable: true, get() { getterReads++; return originalProbe; } });
  const descriptor = await openCommandFile(subject.context, "/borrowed", { access: "write", append: true });
  Object.defineProperty(subject.context.fs, "open", { value: async () => { throw new Error("must not reopen"); } });
  Object.defineProperty(subject.source, "probeRead", { value: async () => { throw new Error("replacement observation"); } });
  try {
    assert.equal(await descriptor.probeRead!(), "blocked");
    assert.equal(getterReads, 1);
    assert.equal(subject.resource.charged, 0);
    assert.equal(await descriptor.write(Uint8Array.of(99, 98, 97), 0), 2);
    assert.deepEqual(subject.resource.bytes, [99, 98, 30]);
    assert.equal(await descriptor.getPosition!(), 1);
    assert.equal(await descriptor.write(Uint8Array.of(70, 80, 90), null), 2);
    assert.deepEqual(subject.resource.bytes, [99, 98, 30, 70, 80]);
    assert.equal(await descriptor.getPosition!(), 5);
    assert.deepEqual(subject.positions, [0, null]);
    assert.equal(subject.resource.charged, 4);
    assert.equal(subject.resource.opens, 1);
  } finally { await descriptor.close(); }
  assert.equal(subject.resource.closes, 1);
});

for (const reason of [null, false, 0, ""]) {
  test(`append helper review: capability getter cancellation ${String(reason)} drains close before rejecting without publishing`, { timeout: 2000 }, async () => {
    const subject = fixture(true);
    const started = deferred();
    const release = deferred();
    const originalClose = subject.source.close;
    Object.defineProperty(subject.capabilities, "positionedAppendWrite", { enumerable: true, get() {
      subject.controller.abort(reason);
      return true;
    } });
    subject.source.close = async function () {
      assert.equal(this, subject.source);
      started.resolve();
      await release.promise;
      await originalClose.call(this);
      throw new Error("secondary close failure");
    };
    let published: FileDescriptor | undefined;
    let settled = false;
    const opening = openCommandFile(subject.context, "/borrowed", { access: "write", append: true });
    const outcome = opening.then(value => {
      published = value;
      settled = true;
      return { state: "published" };
    }, error => {
      settled = true;
      return { state: "rejected", error };
    });
    try {
      assert.deepEqual(await Promise.race([outcome, started.promise.then(() => ({ state: "cleanup" }))]), { state: "cleanup" });
      assert.equal(settled, false);
      assert.equal(subject.resource.charged, 0);
      release.resolve();
      assert.deepEqual(await outcome, { state: "rejected", error: reason });
      assert.equal(subject.resource.closes, 1);
      assert.deepEqual(await Promise.allSettled(subject.cleanups.map(cleanup => cleanup())), [{ status: "rejected", reason }]);
    } finally {
      release.resolve();
      await outcome;
      await Promise.allSettled([published?.close(), ...subject.cleanups.map(cleanup => cleanup())]);
    }
  });
}

for (const reason of [undefined, null, false, 0, ""]) {
  test(`append helper review: thrown capability getter ${String(reason)} preserves identity and closes once`, async () => {
    const subject = fixture(true);
    Object.defineProperty(subject.capabilities, "positionedAppendWrite", { enumerable: true, get() { throw reason; } });
    await assert.rejects(openCommandFile(subject.context, "/borrowed", { access: "write", append: true }), error => Object.is(error, reason));
    await Promise.all(subject.cleanups.map(cleanup => cleanup()));
    assert.equal(subject.resource.closes, 1);
    assert.equal(subject.resource.charged, 0);
    assert.deepEqual(subject.positions, []);
  });
}

test("append helper review: provider-reentrant close drains admitted positioned writes and skips queued cancellation", { timeout: 2000 }, async () => {
  const subject = fixture(true);
  const started = deferred();
  const release = deferred();
  const originalWrite = subject.source.write;
  let closing: Promise<void> | undefined;
  subject.source.write = async function (bytes, position, options) {
    assert.equal(this, subject.source);
    if (position === 0) {
      closing = descriptor.close();
      started.resolve();
      await release.promise;
    }
    return originalWrite.call(this, bytes, position, options);
  };
  const descriptor = await openCommandFile(subject.context, "/borrowed", { access: "write", append: true });
  const controller = new AbortController();
  const first = descriptor.write(Uint8Array.of(99), 0);
  const canceled = assert.rejects(descriptor.write(Uint8Array.of(88), 1, { signal: controller.signal }), error => error === false);
  const last = descriptor.write(Uint8Array.of(77), 2);
  try {
    await started.promise;
    controller.abort(false);
    assert.equal(descriptor.close(), closing);
    assert.equal(subject.resource.closes, 0);
    await assert.rejects(descriptor.write(Uint8Array.of(66), 0), { code: "EBADF" });
    release.resolve();
    assert.equal(await first, 1);
    await canceled;
    assert.equal(await last, 1);
    await closing;
    assert.deepEqual(subject.positions, [0, 2]);
    assert.equal(subject.resource.charged, 2);
    assert.equal(subject.resource.closes, 1);
  } finally {
    release.resolve();
    await Promise.allSettled([first, canceled, last, descriptor.close(), ...subject.cleanups.map(cleanup => cleanup())]);
  }
});
