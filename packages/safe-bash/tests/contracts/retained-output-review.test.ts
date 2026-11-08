import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, FsError, type FileSystem } from "poe-code/safe-fs";
import type { InvocationCleanup } from "../../src/contracts/command.js";
import { openCommandFile, type CommandFileDescriptor } from "../../src/contracts/filesystem-descriptor.js";
import { bindFileOutputBudget, openFileOutput } from "../../src/contracts/filesystem-output.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

const cancellableOperations: { name: string; invoke(descriptor: CommandFileDescriptor, signal: AbortSignal): Promise<unknown> }[] = [
  { name: "stat", invoke: (descriptor, signal) => descriptor.stat({ signal }) },
  { name: "read", invoke: (descriptor, signal) => descriptor.read(new Uint8Array(1), null, { signal }) },
  { name: "write", invoke: (descriptor, signal) => descriptor.write(Uint8Array.of(99), null, { signal }) },
  { name: "truncate", invoke: (descriptor, signal) => descriptor.truncate(0, { signal }) },
  { name: "sync", invoke: (descriptor, signal) => descriptor.sync(false, { signal }) },
  { name: "data sync", invoke: (descriptor, signal) => descriptor.sync(true, { signal }) },
  { name: "position", invoke: (descriptor, signal) => descriptor.getPosition!({ signal }) },
];

for (const operation of cancellableOperations) test(`retained output ${operation.name} preserves canonical operation cancellation after close`, async () => {
  const reasons = [false, 0, "", null];
  const outcomes: unknown[] = [];
  for (const reason of reasons) {
    const fs = createMemoryFileSystem();
    const context = { fs, signal: new AbortController().signal };
    const canonical = await openCommandFile(context, "/canonical", { access: "write", creation: "ifMissing" });
    const target = await openFileOutput(context, "/out", { flag: "w", descriptor: true });
    assert.ok(target.descriptor);
    if (operation.name === "position") {
      assert.equal(typeof canonical.getPosition, "function");
      assert.equal(typeof target.descriptor.getPosition, "function");
    }
    try {
      await canonical.close();
      await target.finish();
      const controller = new AbortController();
      controller.abort(reason);
      await assert.rejects(operation.invoke(canonical, controller.signal), error => Object.is(error, reason));
      outcomes.push(await operation.invoke(target.descriptor, controller.signal).then(
        () => ({ rejected: false }),
        (error: unknown) => ({ rejected: true, reason: error }),
      ));
    } finally { await Promise.allSettled([canonical.close(), target.finish()]); }
  }
  assert.deepEqual(outcomes, reasons.map(reason => ({ rejected: true, reason })));
});

function override<Value extends object>(target: Value, replacements: Partial<Value>): Value {
  return new Proxy(target, { get(object, key) {
    if (Object.hasOwn(replacements, key)) return Reflect.get(replacements, key);
    const member: unknown = Reflect.get(object, key, object);
    return typeof member === "function" ? member.bind(object) : member;
  } });
}

const operations: { name: string; invoke(descriptor: CommandFileDescriptor): Promise<unknown> }[] = [
  { name: "write", invoke: descriptor => descriptor.write(Uint8Array.of(99), null) },
  { name: "truncate", invoke: descriptor => descriptor.truncate(0) },
  { name: "stat", invoke: descriptor => descriptor.stat() },
];

for (const closing of ["finish", "registered cleanup"]) for (const operation of operations) {
  test(`retained output closes exposed ${operation.name} admission during ${closing}, without cancelling admitted sink bytes`, async () => {
    const backing = createMemoryFileSystem();
    const entered = deferred(), release = deferred();
    const cleanups: InvocationCleanup[] = [];
    let closes = 0, calls = 0, charged = 0;
    const requests: number[] = [];
    const fs = override<FileSystem>(backing, {
      async open(path, options) {
        assert.equal(cleanups.length, 1);
        const retained = await backing.open!(path, options);
        return override(retained, {
          async write(bytes, position, forwarded) {
            calls++;
            requests.push(bytes.length);
            if (calls === 1) { entered.resolve(); await release.promise; }
            return retained.write(calls === 1 ? bytes.subarray(0, Math.max(1, bytes.length - 1)) : bytes, position, forwarded);
          },
          async close() { closes++; await retained.close(); },
        });
      },
    });
    const context = {
      fs, signal: new AbortController().signal,
      registerCleanup(cleanup: InvocationCleanup) { cleanups.push(cleanup); },
    };
    bindFileOutputBudget(context, () => { throw new Error("Unexpected legacy sink budget"); }, async (bytes, write) => {
      charged += bytes.length;
      const count = await write();
      charged -= bytes.length - count;
      return count;
    });
    const target = await openFileOutput(context, "/out", { flag: "w", descriptor: true });
    assert.ok(target.descriptor);
    const input = new Uint8Array(operation.name === "write" ? 65537 : 2).fill(97);
    const writing = target.sink.write(input);
    await entered.promise;
    const retirement = closing === "finish" ? target.finish() : Promise.resolve(cleanups[0]!());
    const late = operation.invoke(target.descriptor).then(
      () => ({ rejected: false, reason: undefined }),
      (reason: unknown) => ({ rejected: true, reason }),
    );
    try {
      await assert.rejects(target.sink.write(Uint8Array.of(100)), { code: "EBADF" });
      assert.equal(closes, 0);
      release.resolve();
      await Promise.all([writing, retirement]);
      const outcome = await late;
      assert.equal(outcome.rejected, true, `Exposed descriptor ${operation.name} was admitted after ${closing}`);
      assert.ok(outcome.reason instanceof FsError && outcome.reason.code === "EBADF");
      assert.deepEqual(await backing.readFile("/out"), input);
      assert.equal(charged, input.length);
      assert.ok(requests.every(length => length <= 65536));
      assert.equal(calls, 2);
      assert.equal(closes, 1);
    } finally {
      release.resolve();
      await Promise.allSettled([writing, retirement, late]);
      await Promise.allSettled(cleanups.map(async cleanup => cleanup()));
    }
  });
}
