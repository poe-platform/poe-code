import { expect, it, vi } from "vitest";
import { Budget, createRealm } from "./core.js";

it.each([undefined, "after-prefix"] as const)(
  "discards a custom-prototype Script completion with %s scheduling",
  async (callbackScheduling) => {
    const realm = createRealm({ classicScripts: true, callbackScheduling });
    try {
      expect(Object.getOwnPropertyDescriptor(realm, "supportsDiscardResult")).toMatchObject({
        value: true,
        writable: false,
        configurable: false
      });
      const result = await realm.evaluate(
        "globalThis.loaded = Object.create({ ready: true }); loaded;",
        { discardResult: true }
      );
      expect(result).toMatchObject({ ok: true });
      expect(result).not.toHaveProperty("returnValue");
      expect(await realm.evaluate("loaded.ready")).toMatchObject({ ok: true, returnValue: true });
    } finally {
      await realm.close();
    }
  }
);

it.each([undefined, false])("preserves normal result export (%s)", async (discardResult) => {
  const realm = createRealm({ classicScripts: true });
  try {
    expect(await realm.evaluate("21 * 2", { discardResult })).toMatchObject({
      ok: true,
      returnValue: 42
    });
  } finally {
    await realm.close();
  }
});

it("preserves rejection of non-data results when export is requested", async () => {
  const realm = createRealm({ classicScripts: true });
  try {
    await expect(realm.evaluate("Object.create({ ready: true })")).rejects.toThrow(
      /Guest prototype links/
    );
  } finally {
    await realm.close();
  }
});

it("discards function-body returns without changing evaluation effects", async () => {
  const realm = createRealm();
  try {
    expect(
      await realm.evaluate("globalThis.count = 42; return Object.create({ ready: true });", {
        discardResult: true
      })
    ).toMatchObject({ ok: true });
    expect(await realm.evaluate("return globalThis.count;")).toMatchObject({
      ok: true,
      returnValue: 42
    });
  } finally {
    await realm.close();
  }
});

it.each([undefined, "after-prefix"] as const)(
  "keeps resource failures fatal with %s scheduling",
  async (callbackScheduling) => {
    const realm = createRealm({ callbackScheduling, budget: new Budget({ maxSteps: 1000 }) });
    try {
      await expect(realm.evaluate("while(true){}", { discardResult: true })).rejects.toMatchObject({
        code: "budgetExceeded",
        budget: "steps"
      });
    } finally {
      await realm.close();
    }
  }
);

it("enforces retained data limits even when result export is discarded", async () => {
  const realm = createRealm({ budget: new Budget({ dataSize: 10000 }) });
  try {
    await expect(
      realm.evaluate('return { value: "x".repeat(20000) };', { discardResult: true })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
  } finally {
    await realm.close();
  }
});

it("retains opt-in ordinary Script exception recovery", async () => {
  const realm = createRealm({ classicScripts: true, classicScriptErrors: "report" });
  try {
    expect(
      await realm.evaluate('throw new Error("expected")', { discardResult: true })
    ).toMatchObject({ ok: false, recoverable: true });
    expect(await realm.evaluate("42")).toMatchObject({ ok: true, returnValue: 42 });
  } finally {
    await realm.close();
  }
});

it("rejects an accessor discard option without invoking it", async () => {
  const getter = vi.fn(() => true);
  const realm = createRealm();
  try {
    await expect(
      realm.evaluate("return 42;", Object.defineProperty({}, "discardResult", { get: getter }))
    ).rejects.toThrow(TypeError);
  } finally {
    await realm.close();
  }
  expect(getter).not.toHaveBeenCalled();
});

it.each([null, 1, "true", {}])("rejects malformed discardResult %j", async (discardResult) => {
  const realm = createRealm();
  try {
    await expect(realm.evaluate("return 42;", { discardResult } as never)).rejects.toThrow(
      TypeError
    );
  } finally {
    await realm.close();
  }
});
