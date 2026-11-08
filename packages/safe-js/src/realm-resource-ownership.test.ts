import { beforeEach, expect, it, vi } from "vitest";
import { createRealm } from "./realm.js";
import { defineExtension } from "./extensions.js";

const workers = vi.hoisted(() => [] as Array<{ terminate: ReturnType<typeof vi.fn> }>);
vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    ...await vi.importActual<typeof import("node:worker_threads")>("node:worker_threads"),
    Worker: class extends EventEmitter {
      terminate = vi.fn(async () => { this.emit("exit", 1); return 1; });
      constructor() { super(); workers.push(this); }
      postMessage({ id }: { id: number }) {
        this.emit("message", { id, kind: "registered", async: true });
        this.emit("message", { id, kind: "settled", value: "ok" });
      }
    }
  };
});
beforeEach(() => { workers.length = 0; });

it("reuses its atomic worker across evaluations without consuming another cleanup slot", async () => {
  const realm = createRealm({ limits: { cleanups: 1 } });
  try {
    for (const filename of ["first", "second"]) {
      expect(await realm.evaluate(
        "return await Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(4)),0,0).value;",
        { filename }
      )).toMatchObject({ ok: true, returnValue: "ok" });
    }
    expect(workers).toHaveLength(1);
  } finally { await realm.close(); }
  expect(workers[0].terminate).toHaveBeenCalledTimes(1);
});

it("keeps distinct realm workers alive until their own owner closes", async () => {
  const first = createRealm();
  const second = createRealm();
  const source = "return await Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(4)),0,0).value;";
  try {
    expect(await first.evaluate(source)).toMatchObject({ ok: true, returnValue: "ok" });
    expect(await second.evaluate(source)).toMatchObject({ ok: true, returnValue: "ok" });
    expect(workers).toHaveLength(2);
    await first.close();
    await first.close();
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    expect(workers[1].terminate).not.toHaveBeenCalled();
    expect(await second.evaluate("return 42;")).toMatchObject({ ok: true, returnValue: 42 });
  } finally { await first.close(); await second.close(); }
  expect(workers[1].terminate).toHaveBeenCalledTimes(1);
});

it("does not create an unowned worker when cleanup registration is refused", async () => {
  const cleanup = vi.fn();
  const realm = createRealm({
    limits: { cleanups: 1 },
    extensions: [defineExtension({
      manifest: { version: 1, name: "occupy-cleanup" },
      setup(context) { context.onCleanup(cleanup); return {}; }
    })]
  });
  try {
    await expect(realm.evaluate(
      "return await Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(4)),0,0).value;"
    )).rejects.toThrow("Realm cleanup limit exceeded.");
    expect(workers).toHaveLength(0);
    expect(cleanup).toHaveBeenCalledTimes(1);
  } finally { await realm.close(); }
});

it("shares the worker with callbacks and authorized nested evaluations", async () => {
  let callback: unknown;
  const wait = "await Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(4)),0,0).value";
  const realm = createRealm({
    limits: { cleanups: 1 },
    grants: ["source:nested"],
    bindings: { save: (value: unknown) => { callback = value; } },
    extensions: [defineExtension({
      manifest: { version: 1, name: "nested-wait", capabilities: ["source:nested"], globals: ["nested"] },
      setup(context) {
        return { globals: { nested: context.nestedOperation(() => context.evaluateNested(`${wait};`)) } };
      }
    })]
  });
  try {
    expect(await realm.evaluate(`save(async () => ${wait}); ${wait}; await nested(); return 1;`))
      .toMatchObject({ ok: true, returnValue: 1 });
    expect(await realm.invokeCallback(callback)).toBe("ok");
    expect(workers).toHaveLength(1);
    realm.releaseCallback(callback);
    await expect(realm.invokeCallback(callback)).rejects.toThrow("revoked");
  } finally { await realm.close(); }
  expect(workers[0].terminate).toHaveBeenCalledTimes(1);
});

it("reports worker termination failure while still running every other disposer", async () => {
  const cleanup = vi.fn();
  const failure = new Error("termination failed");
  const realm = createRealm({ extensions: [defineExtension({
    manifest: { version: 1, name: "cleanup-control" },
    setup(context) { context.onCleanup(cleanup); return {}; }
  })] });
  await realm.evaluate("return await Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(4)),0,0).value;");
  workers[0].terminate.mockRejectedValue(failure);
  await expect(realm.close()).rejects.toMatchObject({ errors: [failure] });
  await expect(realm.close()).rejects.toMatchObject({ errors: [failure] });
  expect(workers[0].terminate).toHaveBeenCalledTimes(1);
  expect(cleanup).toHaveBeenCalledTimes(1);
});
