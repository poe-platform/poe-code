import { describe, expect, it, vi } from "vitest";
import { Budget, createRealm, defineExtension, type HostObjectDefinition, type HostObjectNamedDefinition } from "./core.js";

function storageRealm(options: {
  named?: Partial<HostObjectNamedDefinition>;
  fixed?: Pick<HostObjectDefinition, "properties" | "indexed">;
  budget?: Budget;
  signal?: AbortSignal;
} = {}) {
  const values = new Map<string, unknown>();
  const set = vi.fn((name: string, value: unknown) => { values.set(name, value); });
  const remove = vi.fn((name: string) => values.delete(name));
  const keys = vi.fn(() => [...values.keys()]);
  const realm = createRealm({ budget: options.budget, signal: options.signal, extensions: [defineExtension({
    manifest: { version: 1, name: "storage", globals: ["storage"] },
    setup(context) {
      return { globals: { storage: context.createHostObject({
        ...options.fixed,
        methods: { getItem: (name: string) => values.get(name) ?? null },
        named: { keys, get: (name: string) => values.get(name), set, delete: remove, maxKeys: 16, maxKeyCodeUnits: 128, ...options.named }
      }) } };
    }
  })] });
  return { realm, values, keys, set, remove };
}

describe("opt-in named host mutations", () => {
  it("creates, updates and deletes live named properties with normal expression results", async () => {
    const { realm, values, set, remove } = storageRealm();
    try {
      expect(await realm.evaluate(`
        const assigned = storage.theme = "dark";
        storage.theme += "!";
        storage.count = 1; const previous = storage.count++;
        const before = [assigned, storage.getItem("theme"), previous, storage.count, Object.keys(storage)];
        const removed = delete storage.theme;
        return [before, removed, delete storage.absent, storage.getItem("theme"), "theme" in storage, Object.hasOwn(storage, "count")];
      `)).toMatchObject({ returnValue: [["dark", "dark!", 1, 2, ["getItem", "theme", "count"]], true, true, null, false, true] });
      expect(values).toEqual(new Map([["count", 2]]));
      expect(set).toHaveBeenCalledTimes(4);
      expect(remove.mock.calls).toEqual([["theme"]]);
    } finally { await realm.close(); }
  });

  it("keeps declarations without mutators read-only", async () => {
    const { realm, values, set, remove } = storageRealm({ named: { set: undefined, delete: undefined } });
    values.set("theme", "light");
    try {
      expect(await realm.evaluate(`
        let denied = 0;
        try { storage.theme = "dark"; } catch { denied++; }
        try { delete storage.theme; } catch { denied++; }
        return [denied, storage.theme];
      `)).toMatchObject({ returnValue: [2, "light"] });
      expect(set).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    } finally { await realm.close(); }
  });

  it("refuses new keys over quota before calling the setter but permits updates", async () => {
    const { realm, values, set } = storageRealm({ named: { maxKeys: 1, maxKeyCodeUnits: 4 } });
    values.set("name", 1);
    try {
      expect(await realm.evaluate(`
        let denied = false;
        try { storage.new = 2; } catch { denied = true; }
        storage.name = 3;
        return [denied, storage.name, Object.keys(storage)];
      `)).toMatchObject({ returnValue: [true, 3, ["getItem", "name"]] });
      expect(set.mock.calls).toEqual([["name", 3]]);
      expect(values.size).toBe(1);
    } finally { await realm.close(); }
  });

  it("protects fixed and indexed members without invoking named mutation providers", async () => {
    let fixed = 1;
    const { realm, set, remove } = storageRealm({ fixed: {
      indexed: { length: () => 1, get: () => 9, maxLength: 4 },
      properties: { fixed: { get: () => fixed, set: (value) => { fixed = value as number; } }, locked: { get: () => 5 } }
    } });
    try {
      expect(await realm.evaluate(`
        storage.fixed = 2;
        let denied = 0;
        for (const key of ["getItem", "locked", "0", "99", "length"]) {
          try { storage[key] = 8; } catch { denied++; }
          try { delete storage[key]; } catch { denied++; }
        }
        try { delete storage.fixed; } catch { denied++; }
        return [denied, storage.fixed, storage.locked, storage[0], storage.length];
      `)).toMatchObject({ returnValue: [11, 2, 5, 9, 1] });
      expect(set).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    } finally { await realm.close(); }
  });

  it("preserves a false deletion result for an existing named property", async () => {
    const { realm, values } = storageRealm({ named: { delete: () => false } });
    values.set("keep", 1);
    try {
      expect(await realm.evaluate("return [delete storage.keep, storage.keep, delete storage.missing];"))
        .toMatchObject({ returnValue: [false, 1, true] });
    } finally { await realm.close(); }
  });

  it("rejects declared asynchronous setters before native mutation", async () => {
    let calls = 0;
    const { realm } = storageRealm({ named: { set: async () => { calls++; } } });
    try {
      await expect(realm.evaluate('storage.theme = "dark";')).rejects.toThrow(/synchronous/);
      expect(calls).toBe(0);
    } finally { await realm.close(); }
  });

  it("preserves saved identity across native updates and copies ordinary assigned values", async () => {
    const { realm, values } = storageRealm();
    try {
      expect(await realm.evaluate('const saved = storage; const object = { value: 1 }; return (storage.object = object) === object;'))
        .toMatchObject({ returnValue: true });
      values.set("theme", "native");
      expect(await realm.evaluate('object.value = 2; return [saved === storage, saved.theme, saved.object.value];'))
        .toMatchObject({ returnValue: [true, "native", 1] });
      values.delete("theme");
      expect(await realm.evaluate('return [saved.theme, delete saved.theme];'))
        .toMatchObject({ returnValue: [undefined, true] });
    } finally { await realm.close(); }
  });

  it.each(["set", "delete"] as const)("enables %s independently", async (operation) => {
    const { realm, values } = storageRealm({ named: operation === "set" ? { delete: undefined } : { set: undefined } });
    values.set("key", 1);
    try {
      expect(await realm.evaluate(operation === "set" ? 'return storage.key = 2;' : 'return delete storage.key;'))
        .toMatchObject({ returnValue: operation === "set" ? 2 : true });
      await expect(realm.evaluate(operation === "set" ? 'delete storage.key;' : 'storage.key = 2;')).rejects.toThrow();
    } finally { await realm.close(); }
  });

  it.each(["", "0", "4294967295", "01", "-1", "1.0", "toString", "hasOwnProperty", "💡"])("accepts ordinary named key %j", async (name) => {
    const { realm, set, remove } = storageRealm();
    const key = JSON.stringify(name);
    try {
      expect(await realm.evaluate(`storage[${key}] = 7; return [storage[${key}], Object.hasOwn(storage, ${key}), delete storage[${key}]];`))
        .toMatchObject({ returnValue: [7, true, true] });
      expect(set).toHaveBeenCalledWith(name, 7);
      expect(remove).toHaveBeenCalledWith(name);
    } finally { await realm.close(); }
  });

  it.each(["constructor", "prototype", "__proto__"])("rejects protected key %s before mutation", async (name) => {
    const { realm, set, remove } = storageRealm();
    try {
      expect(await realm.evaluate(`let denied = 0; try { storage[${JSON.stringify(name)}] = 7; } catch { denied++; } try { delete storage[${JSON.stringify(name)}]; } catch { denied++; } return denied;`))
        .toMatchObject({ returnValue: 2 });
      expect(set).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    } finally { await realm.close(); }
  });

  it("checks prospective aggregate UTF-16 units before invoking the provider", async () => {
    const { realm, values, set } = storageRealm({ named: { maxKeyCodeUnits: 3 } });
    values.set("ab", 1);
    try {
      await expect(realm.evaluate('storage["💡"] = 2;')).rejects.toThrow(/UTF-16/);
      expect(set).not.toHaveBeenCalled();
    } finally { await realm.close(); }
  });

  it("checks prospective array length before invoking the provider", async () => {
    const { realm, values, set } = storageRealm({ budget: new Budget({ arrayLength: 1 }) });
    values.set("a", 1);
    try {
      await expect(realm.evaluate('storage.b = 2;')).rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
      expect(set).not.toHaveBeenCalled();
    } finally { await realm.close(); }
  });

  it("checks property-name string budgets before native mutation", async () => {
    const { realm, set } = storageRealm({ budget: new Budget({ stringLength: 8 }) });
    try {
      await expect(realm.evaluate('storage.longPropertyName = 1;')).rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
      expect(set).not.toHaveBeenCalled();
    } finally { await realm.close(); }
  });

  it("meters repeated writes and stops providers after fatal exhaustion", async () => {
    const { realm, set } = storageRealm({ budget: new Budget({ maxSteps: 100 }) });
    try {
      await expect(realm.evaluate('while (true) { try { storage.key = 1; } catch {} }')).rejects.toMatchObject({ code: "budgetExceeded" });
      const calls = set.mock.calls.length;
      expect(calls).toBeGreaterThan(0);
      await expect(realm.evaluate('storage.key = 2;')).rejects.toThrow();
      expect(set).toHaveBeenCalledTimes(calls);
    } finally { await realm.close(); }
  });

  it("validates native post-mutation keys without claiming rollback", async () => {
    const { realm, values } = storageRealm({ named: { maxKeys: 1, set(name, value) { values.set(name, value); values.set("extra", 1); } } });
    try {
      await expect(realm.evaluate('storage.key = 1;')).rejects.toThrow(/maxKeys/);
      expect(values.size).toBe(2);
    } finally { await realm.close(); }
  });

  it.each(["set", "delete"] as const)("observes rejected promises from normal %s providers", async (operation) => {
    const provider = () => Promise.reject(new Error("native rejection"));
    const { realm, values } = storageRealm({ named: { [operation]: provider } as Partial<HostObjectNamedDefinition> });
    values.set("key", 1);
    try {
      await expect(realm.evaluate(operation === "set" ? 'storage.key = 2;' : 'delete storage.key;')).rejects.toThrow(/synchronous/);
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally { await realm.close(); }
  });

  it.each(["set", "delete"] as const)("propagates %s provider errors", async (operation) => {
    const { realm, values } = storageRealm({ named: { [operation]: () => { throw new Error("storage quota"); } } });
    values.set("key", 1);
    try {
      await expect(realm.evaluate(operation === "set" ? 'storage.key = 2;' : 'delete storage.key;')).rejects.toThrow(/storage quota/);
      expect(values.get("key")).toBe(1);
    } finally { await realm.close(); }
  });

  it("does not coerce invalid delete results or call proxy providers", async () => {
    const trap = vi.fn(() => { throw new Error("trap"); });
    const result = new Proxy({}, { get: trap });
    const first = storageRealm({ named: { delete: (() => result) as unknown as (name: string) => boolean } });
    first.values.set("key", 1);
    const second = storageRealm({ named: { set: new Proxy(() => {}, { apply: trap }) } });
    try {
      await expect(first.realm.evaluate('delete storage.key;')).rejects.toThrow(/boolean/);
      await expect(second.realm.evaluate('storage.key = 1;')).rejects.toThrow(/proxy/);
      expect(trap).not.toHaveBeenCalled();
    } finally { await first.realm.close(); await second.realm.close(); }
  });

  it("revokes callbacks saved by setters when the realm closes", async () => {
    const { realm, values, set } = storageRealm();
    await realm.evaluate('storage.callback = () => { storage.key = 1; };');
    const callback = values.get("callback");
    await realm.close();
    await expect(realm.invokeCallback(callback)).rejects.toThrow(/closed/);
    await expect(realm.evaluate('storage.key = 2;')).rejects.toThrow(/closed/);
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("preserves same-owner handles and refuses foreign ones before mutation", async () => {
    const foreign = storageRealm();
    const value = await foreign.realm.evaluate('return storage;');
    if (!value.ok) throw new Error("Foreign fixture failed");
    const local = storageRealm({ named: { get: () => value.returnValue } });
    local.values.set("foreign", value.returnValue);
    try {
      expect(await foreign.realm.evaluate('storage.self = storage; return storage.self === storage;'))
        .toMatchObject({ returnValue: true });
      await expect(local.realm.evaluate('storage.copy = storage.foreign;')).rejects.toThrow(/Foreign realm/);
      expect(local.set).not.toHaveBeenCalled();
    } finally { await foreign.realm.close(); await local.realm.close(); }
  });

  it("rejects unsupported value conversion before invoking the setter", async () => {
    const { realm, set } = storageRealm();
    try {
      await expect(realm.evaluate('storage.object = { get value() { throw new Error("getter ran"); } };')).rejects.toThrow();
      expect(set).not.toHaveBeenCalled();
    } finally { await realm.close(); }
  });

  it.each(["abort", "close"] as const)("stops after native %s during mutation", async (mode) => {
    const controller = new AbortController();
    let closed: Promise<void> | undefined;
    const { realm, values } = storageRealm({ signal: controller.signal, named: { set(name, value) {
      values.set(name, value);
      if (mode === "abort") controller.abort(new Error("cancelled"));
      else closed = realm.close();
    } } });
    try {
      await expect(realm.evaluate('storage.first = 1; storage.second = 2;')).rejects.toThrow();
      expect(values).toEqual(new Map([["first", 1]]));
    } finally { await closed; await realm.close(); }
  });

  it("rejects mutations after external cancellation", async () => {
    const controller = new AbortController();
    const { realm, set, remove } = storageRealm({ signal: controller.signal });
    await realm.evaluate('const saved = storage;');
    controller.abort(new Error("cancelled"));
    try {
      await expect(realm.evaluate('saved.key = 1; delete saved.key;')).rejects.toThrow(/cancelled/);
      expect(set).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    } finally { await realm.close(); }
  });

  it("checks data budgets for native key snapshots before mutation", async () => {
    const { realm, values, set } = storageRealm({ budget: new Budget({ dataSize: 1000 }), named: { maxKeyCodeUnits: 10000 } });
    values.set("x".repeat(2000), 1);
    try {
      await expect(realm.evaluate('storage.key = 2;')).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
      expect(set).not.toHaveBeenCalled();
    } finally { await realm.close(); }
  });

  it.each(["set", "delete"] as const)("rejects generator and asynchronous %s definitions", async (operation) => {
    for (const provider of [async () => true, function* () { yield true; }, 1]) {
      const { realm } = storageRealm({ named: { [operation]: provider } as Partial<HostObjectNamedDefinition> });
      try {
        await expect(realm.evaluate('storage.key;')).rejects.toThrow(/synchronous/);
      } finally { await realm.close(); }
    }
  });

  it("allows noncanonical numeric names alongside indexed members", async () => {
    const { realm } = storageRealm({ fixed: { indexed: { length: () => 1, get: () => 7, maxLength: 4 } } });
    try {
      expect(await realm.evaluate('storage["01"] = 2; storage["4294967295"] = 3; return [storage[0], storage["01"], storage["4294967295"], delete storage["01"]];'))
        .toMatchObject({ returnValue: [7, 2, 3, true] });
    } finally { await realm.close(); }
  });
});
