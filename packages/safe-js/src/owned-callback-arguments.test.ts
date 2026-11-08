import { expect, it } from "vitest";
import { Budget, createRealm, defineExtension, type ExtensionContext } from "./core.js";

it("releases one consumer without revoking other captures of the same guest function", async () => {
  const owned: unknown[] = [];
  const shared: unknown[] = [];
  const extension = defineExtension({
    manifest: { version: 1, name: "owned", capabilities: ["guest:retain"], globals: ["own", "save", "read"] },
    setup(context) {
      return { globals: {
        own: context.retainCallbackArguments((callback: unknown) => { owned.push(callback); }),
        save: (callback: unknown) => { shared.push(callback); },
        read: () => owned[1]
      } };
    }
  });
  const realm = createRealm({ extensions: [extension], grants: ["guest:retain"] });
  try {
    await realm.evaluate("const f = () => 7; save(f); own(f); own(f); save(f);");
    expect(owned[0]).not.toBe(owned[1]);
    expect(owned[0]).not.toBe(shared[0]);
    expect(shared[0]).toBe(shared[1]);
    realm.releaseCallback(owned[0]);
    expect(await realm.invokeCallback(owned[1])).toBe(7);
    expect(await realm.invokeCallback(shared[0])).toBe(7);
    expect(await realm.evaluate("return read() === f;")).toMatchObject({ returnValue: true });
    await expect(realm.invokeCallback(owned[0])).rejects.toThrow(/revoked/i);
  } finally { await realm.close(); }
});

it("reuses callback quota and frees captured data after sequential consumers finish", async () => {
  let callback: unknown;
  const budget = new Budget({ dataSize: 10000 });
  const extension = defineExtension({
    manifest: { version: 1, name: "sequential", capabilities: ["guest:retain"], globals: ["own"] },
    setup(context) {
      return { globals: { own: context.retainCallbackArguments((value: unknown) => { callback = value; }) } };
    }
  });
  const realm = createRealm({ extensions: [extension], grants: ["guest:retain"], budget, limits: { callbacks: 1 } });
  try {
    for (let index = 0; index < 4; index++) {
      await realm.evaluate("own((() => { const data = Array(1000).fill(1); return () => data.length; })());");
      expect(await realm.invokeCallback(callback)).toBe(1000);
      const before = budget.currentDataSize;
      realm.releaseCallback(callback);
      expect(budget.currentDataSize).toBeLessThan(before - 999);
    }
  } finally { await realm.close(); }
  expect(budget.currentDataSize).toBe(0);
});

it("combines owned callbacks with retained timer arguments and live receiver identity", async () => {
  const pending: unknown[][] = [];
  const extension = defineExtension({
    manifest: { version: 1, name: "timers", capabilities: ["guest:retain"], globals: ["schedule"] },
    setup(context) {
      const schedule = context.retainCallbackArguments((...args: unknown[]) => { pending.push(args); });
      return { globals: { schedule: context.retainGuestArguments(schedule, 2) } };
    }
  });
  const realm = createRealm({ extensions: [extension], grants: ["guest:retain"] });
  try {
    await realm.evaluate("const obj = { value: 1 }; function f(arg) { return [this === arg, arg === obj, arg.value]; } schedule(f, 0, obj); schedule(f, 0, obj); obj.value = 9;");
    const [first, second] = pending;
    realm.releaseCallback(first![0]);
    realm.releaseGuestReference(first![2]);
    expect(await realm.invokeCallback(second![0], { thisValue: second![2], args: [second![2]] })).toEqual([true, true, 9]);
    realm.releaseCallback(second![0]);
    realm.releaseGuestReference(second![2]);
  } finally { await realm.close(); }
});

it("rolls back owned callbacks on synchronous host failure without revoking normal exports", async () => {
  const failed: unknown[] = [];
  let shared: unknown;
  const extension = defineExtension({
    manifest: { version: 1, name: "rollback", capabilities: ["guest:retain"], globals: ["save", "fail"] },
    setup(context) {
      return { globals: {
        save: (value: unknown) => { shared = value; },
        fail: context.retainCallbackArguments((value: unknown) => { failed.push(value); throw new Error("failed"); })
      } };
    }
  });
  const realm = createRealm({ extensions: [extension], grants: ["guest:retain"], limits: { callbacks: 2 } });
  try {
    await realm.evaluate("const f = () => 9; save(f); for (let i = 0; i < 4; i++) { try { fail(f); } catch {} }");
    expect(failed).toHaveLength(4);
    expect(await realm.invokeCallback(shared)).toBe(9);
    for (const callback of failed) await expect(realm.invokeCallback(callback)).rejects.toThrow(/revoked/i);
  } finally { await realm.close(); }
});

it("keeps aliases within one exported argument graph and enforces the callback quota", async () => {
  let saved: { a: unknown; b: unknown } | undefined;
  const extension = defineExtension({
    manifest: { version: 1, name: "aliases", capabilities: ["guest:retain"], globals: ["own"] },
    setup(context) {
      return { globals: { own: context.retainCallbackArguments((value: typeof saved) => { saved = value; }) } };
    }
  });
  const realm = createRealm({ extensions: [extension], grants: ["guest:retain"], limits: { callbacks: 1 } });
  try {
    await realm.evaluate("const f = () => 3; own({ a: f, b: f });");
    expect(saved!.a).toBe(saved!.b);
    expect(await realm.invokeCallback(saved!.a)).toBe(3);
    await expect(realm.evaluate("own({ a: f, b: f });")).rejects.toThrow(/callback limit/i);
  } finally { await realm.close(); }
});

it("rolls back callbacks when copying a later argument fails", async () => {
  const received: unknown[] = [];
  const extension = defineExtension({
    manifest: { version: 1, name: "copy-failure", capabilities: ["guest:retain"], globals: ["own"] },
    setup(context) {
      return { globals: { own: context.retainCallbackArguments((callback: unknown) => { received.push(callback); }) } };
    }
  });
  const realm = createRealm({ extensions: [extension], grants: ["guest:retain"], limits: { callbacks: 1 } });
  try {
    await realm.evaluate("const f = () => 8; for (let i = 0; i < 3; i++) { try { own(f, { get value() { return 1; } }); } catch {} } own(f, null);");
    expect(received).toHaveLength(1);
    expect(await realm.invokeCallback(received[0])).toBe(8);
  } finally { await realm.close(); }
});

it("requires a retention grant and setup-time ownership of operations", async () => {
  const operation = () => undefined;
  let context!: ExtensionContext;
  const extension = defineExtension({
    manifest: { version: 1, name: "declaration", capabilities: ["guest:retain"] },
    setup(value) {
      context = value;
      expect(context.retainCallbackArguments(operation)).toBe(operation);
      expect(context.retainCallbackArguments(operation)).toBe(operation);
      expect(() => context.retainCallbackArguments(1 as never)).toThrow(/function/i);
      return {};
    }
  });
  const realm = createRealm({ extensions: [extension], grants: ["guest:retain"] });
  try {
    await realm.evaluate("return 1;");
    expect(() => context.retainCallbackArguments(operation)).toThrow(/setup/i);
  } finally { await realm.close(); }
  const ungranted = createRealm({ extensions: [defineExtension({
    manifest: { version: 1, name: "ungranted" },
    setup(value) { value.retainCallbackArguments(operation); return {}; }
  })] });
  await expect(ungranted.evaluate("return 1;")).rejects.toThrow(/guest:retain/i);
  await ungranted.close();
});
