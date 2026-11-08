import { getEventListeners } from "node:events";
import { expect, it, vi } from "vitest";
import { createRealm, defineExtension } from "./core.js";

it("detaches cancellation listeners on unused close and setup failure", async () => {
  const controller = new AbortController();
  const unused = createRealm({ signal: controller.signal });
  expect(getEventListeners(controller.signal, "abort")).toHaveLength(1);
  await unused.close(); await unused.close();
  expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  const cleanup = vi.fn();
  const realm = createRealm({ signal: controller.signal, extensions: [defineExtension({
    manifest: { version: 1, name: "failed-setup" },
    setup(context) { context.onCleanup(cleanup); throw new Error("setup failed"); }
  })] });
  await expect(realm.evaluate("return 1;")).rejects.toThrow("setup failed");
  await realm.close();
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
});


it("revokes the released handle while preserving a guest-owned closure and its new handle", async () => {
  const callbacks: unknown[] = [];
  const realm = createRealm({ limits: { callbacks: 1 }, bindings: { save: (callback: unknown) => { callbacks.push(callback); } } });
  try {
    await realm.evaluate("let value=0; function increment(){return ++value} save(increment)");
    realm.releaseCallback(callbacks[0]);
    expect(await realm.evaluate("save(increment); return increment()")).toMatchObject({ ok: true, returnValue: 1 });
    expect(callbacks[1]).not.toBe(callbacks[0]);
    await expect(realm.invokeCallback(callbacks[0])).rejects.toThrow("revoked");
    expect(await realm.invokeCallback(callbacks[1])).toBe(2);
  } finally { await realm.close(); }
  await expect(realm.invokeCallback(callbacks[1])).rejects.toThrow("closed");
});

it("unregisters only the closing realm's native finalization cells", async () => {
  const registrations = new Set<object>();
  const notices: Array<() => void> = [];
  vi.stubGlobal("FinalizationRegistry", class {
    constructor(private readonly notify: (cell: object) => void) {}
    register(_target: object, cell: object) {
      if ("heldValue" in cell && (cell.heldValue === 101 || cell.heldValue === 202)) {
        registrations.add(cell);
        notices.push(() => this.notify(cell));
      }
    }
    unregister(cell: object) { return registrations.delete(cell); }
  });
  const record = vi.fn();
  const first = createRealm({ bindings: { record } });
  const second = createRealm({ bindings: { record } });
  try {
    for (const [realm, held] of [[first, 101], [second, 202]] as const) {
      await realm.evaluate(`const target={}; const token={}; const registry=new FinalizationRegistry(record); registry.register(target,${held},token);`);
    }
    expect(registrations.size).toBe(2);
    await first.close(); await first.close();
    expect(registrations.size).toBe(1);
    notices[0]();
    expect(await second.evaluate("return registry.unregister(token)")).toMatchObject({ ok: true, returnValue: true });
    expect(registrations.size).toBe(0);
    expect(record).not.toHaveBeenCalled();
    expect(await second.evaluate("registry.register(target,202,token); return target===target")).toMatchObject({ ok: true, returnValue: true });
    expect(registrations.size).toBe(1);
  } finally {
    await first.close(); await second.close();
    vi.unstubAllGlobals();
  }
  expect(registrations.size).toBe(0);
});
