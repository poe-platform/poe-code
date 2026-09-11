import { expect, it } from "vitest";
import { createDeviceFileSystem } from "../src/fs/devices/index.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import type { FileSystem } from "../src/contracts/filesystem.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

it("closes unconsumed ordinary stream producers exactly once and awaits cleanup", async () => {
  const cleanup = deferred<void>();
  const started = deferred<void>();
  let returned = 0;
  let pulls = 0;
  const backing = { capabilities: {}, readStream: () => ({ [Symbol.asyncIterator]() { return {
    async next() { pulls++; return { done: false, value: new Uint8Array([1]) }; },
    async return() { returned++; started.resolve(); await cleanup.promise; return { done: true, value: undefined }; },
  }; } }) } as unknown as FileSystem;
  const iterator = createDeviceFileSystem(backing).readStream("ordinary")[Symbol.asyncIterator]();
  let settled = false;
  const closed = iterator.return!().then(() => { settled = true; });
  await Promise.race([started.promise, new Promise(resolve => setTimeout(resolve, 10))]);
  expect(returned).toBe(1);
  expect(settled).toBe(false);
  cleanup.resolve();
  await closed;
  await iterator.return!();
  expect(pulls).toBe(0);
  expect(returned).toBe(1);
});

for (const reason of [false, null]) it(`awaits retained copy cleanup after abort ${String(reason)}`, async () => {
  const controller = new AbortController();
  const reading = deferred<void>();
  const pending = deferred<Uint8Array>();
  const closing = deferred<void>();
  const cleanup = deferred<void>();
  let closed = 0;
  let settled = false;
  const view = createDeviceFileSystem({ capabilities: { retainedRead: true }, async openReadFile() { return {
    async read() { reading.resolve(); return pending.promise; },
    async close() { closed++; closing.resolve(); await cleanup.promise; throw new Error("secondary cleanup"); },
  }; } } as unknown as FileSystem);
  const operation = view.copyFile("ordinary", "/dev/null", { signal: controller.signal }).then(
    () => { settled = true; return { ok: true }; }, error => { settled = true; return { error }; },
  );
  await reading.promise;
  controller.abort(reason);
  await closing.promise;
  expect(settled).toBe(false);
  cleanup.resolve();
  expect(await operation).toEqual({ error: reason });
  expect(closed).toBe(1);
  pending.reject(new Error("late read failure"));
});

it("closes retained handles acquired concurrently with cancellation without reading", async () => {
  const controller = new AbortController();
  let reads = 0;
  let closed = 0;
  const view = createDeviceFileSystem({ capabilities: { retainedRead: true }, async openReadFile() {
    controller.abort(0);
    return { async read() { reads++; return new Uint8Array(); }, async close() { closed++; } };
  } } as unknown as FileSystem);
  await expect(view.copyFile("ordinary", "/dev/null", { signal: controller.signal })).rejects.toBe(0);
  expect(reads).toBe(0);
  expect(closed).toBe(1);
});

for (const reason of [null, false, 0, "", NaN, new Error("stop")]) it(`awaits exactly one owned producer return on abort ${String(reason)}`, async () => {
  const view = createDeviceFileSystem(new MemoryFileSystem());
  const controller = new AbortController();
  const started = deferred<void>();
  const pending = deferred<IteratorResult<Uint8Array>>();
  const returning = deferred<void>();
  const cleanup = deferred<void>();
  let returns = 0;
  let settled = false;
  const operation = view.writeStream!("/dev/null", { [Symbol.asyncIterator]() { return {
    next() { started.resolve(); return pending.promise; },
    async return() { returns++; returning.resolve(); await cleanup.promise; throw new Error("cleanup secondary"); },
  }; } }, { signal: controller.signal }).then(() => { settled = true; return { ok: true }; }, error => { settled = true; return { error }; });
  await started.promise;
  controller.abort(reason);
  await returning.promise;
  expect(settled).toBe(false);
  cleanup.resolve();
  expect(await operation).toEqual({ error: reason });
  expect(returns).toBe(1);
  pending.reject(new Error("late producer failure"));
});

it("yields cooperatively for empty and large chunks without retaining input", async () => {
  for (const chunk of [new Uint8Array(), new Uint8Array(1024 * 1024)]) {
    const view = createDeviceFileSystem(new MemoryFileSystem());
    const controller = new AbortController();
    let closed = false;
    let pulls = 0;
    const reason = new Error("fair cancellation");
    const timer = setTimeout(() => controller.abort(reason), 0);
    const source = (async function* () { try { while (true) { pulls++; yield chunk; } } finally { closed = true; } })();
    try { await expect(view.writeStream!("/dev/null", source, { signal: controller.signal })).rejects.toBe(reason); }
    finally { clearTimeout(timer); }
    expect(closed).toBe(true);
    expect(pulls).toBeGreaterThan(0);
    expect(pulls).toBeLessThanOrEqual(256);
  }
});

it("does not acquire a producer for exclusive creation or pre-abort", async () => {
  const view = createDeviceFileSystem(new MemoryFileSystem());
  const source = { [Symbol.asyncIterator](): AsyncIterator<Uint8Array> { throw new Error("must not acquire"); } };
  for (const flag of ["wx", "ax"] as const) await expect(view.writeStream!("/dev/null", source, { flag })).rejects.toMatchObject({ code: "EEXIST" });
  const controller = new AbortController(); controller.abort(false);
  await expect(view.writeStream!("/dev/null", source, { signal: controller.signal })).rejects.toBe(false);
});

it("awaits producer return after EOF and preserves falsey producer errors over cleanup failure", async () => {
  const view = createDeviceFileSystem(new MemoryFileSystem());
  for (const primary of [undefined, false, null, 0, ""]) {
    const started = deferred<void>();
    const cleanup = deferred<void>();
    let returns = 0;
    let settled = false;
    const operation = view.writeStream!("/dev/null", { [Symbol.asyncIterator]() { return {
      async next() { if (primary !== undefined) throw primary; return { done: true as const, value: undefined }; },
      async return() { returns++; started.resolve(); await cleanup.promise; throw new Error("cleanup failure"); },
    }; } }).then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
    await started.promise;
    expect(settled).toBe(false);
    cleanup.resolve();
    const error = await operation;
    if (primary === undefined) expect(error).toMatchObject({ message: "cleanup failure" });
    else expect(error).toBe(primary);
    expect(returns).toBe(1);
  }
});

it("preserves a falsey abort arriving during awaited producer cleanup", async () => {
  const view = createDeviceFileSystem(new MemoryFileSystem());
  const controller = new AbortController();
  const returning = deferred<void>();
  const cleanup = deferred<void>();
  const operation = view.writeStream!("/dev/null", { [Symbol.asyncIterator]() { return {
    async next() { return { done: true as const, value: undefined }; },
    async return() { returning.resolve(); await cleanup.promise; throw new Error("cleanup secondary"); },
  }; } }, { signal: controller.signal }).then(() => "unexpected success", error => error);
  await returning.promise;
  controller.abort(false);
  cleanup.resolve();
  expect(await operation).toBe(false);
});
