import { expect, it } from "vitest";
import { Budget, createRealm } from "./core.js";

async function settled(realm: ReturnType<typeof createRealm>) {
  const until = Date.now() + 2000;
  while (realm.sourceModuleStatus().pendingImports && Date.now() < until)
    await new Promise((resolve) => setTimeout(resolve, 0));
  expect(realm.sourceModuleStatus().pendingImports).toBe(0);
}

it("reports an empty immutable source status without constructing a graph", async () => {
  const realm = createRealm();
  try {
    expect(realm.sourceModuleStatus()).toEqual({
      pendingImports: 0,
      preparedModules: 0,
      fulfilledImports: 0,
      rejectedImports: 0
    });
    expect(Object.isFrozen(realm.sourceModuleStatus())).toBe(true);
  } finally {
    await realm.close();
  }
  expect(() => realm.sourceModuleStatus()).toThrow("closed");
});

it.each([true, false])(
  "distinguishes pending source resolution from successful or caught failed import (%s)",
  async (success) => {
    let release!: (source: { id: string; source: string } | undefined) => void;
    const budget = new Budget({
      maxSteps: 200000,
      dataSize: 200000,
      stringLength: 10000
    });
    const realm = createRealm({
      budget,
      classicScripts: true,
      classicScriptErrors: "report",
      callbackScheduling: "after-prefix",
      sourceResolver: () =>
        new Promise((resolve) => {
          release = resolve;
        })
    });
    try {
      expect(
        await realm.evaluate('void import("./dep.js").catch(()=>{});', {
          filename: "https://fixture.example/main.js",
          discardResult: true
        })
      ).toMatchObject({ ok: true });
      const before = realm.sourceModuleStatus();
      expect(before).toEqual({
        pendingImports: 1,
        preparedModules: 0,
        fulfilledImports: 0,
        rejectedImports: 0
      });
      release(
        success
          ? {
              id: "https://fixture.example/dep.js",
              source: "export const answer=42;"
            }
          : undefined
      );
      await settled(realm);
      expect(realm.sourceModuleStatus()).toEqual({
        pendingImports: 0,
        preparedModules: success ? 1 : 0,
        fulfilledImports: success ? 1 : 0,
        rejectedImports: success ? 0 : 1
      });
      expect(before.pendingImports).toBe(1);
    } finally {
      await realm.close();
    }
    expect(budget.currentDataSize).toBe(0);
  }
);

it("keeps top-level await pending after its source is prepared and releases it on close", async () => {
  const budget = new Budget({
    maxSteps: 200000,
    dataSize: 200000,
    stringLength: 10000
  });
  const realm = createRealm({
    budget,
    classicScripts: true,
    classicScriptErrors: "report",
    callbackScheduling: "after-prefix",
    sourceResolver: () => ({
      id: "https://fixture.example/dep.js",
      source: "await new Promise(()=>{});export const answer=42;"
    })
  });
  try {
    expect(
      await realm.evaluate('void import("./dep.js").catch(()=>{});', {
        filename: "https://fixture.example/main.js",
        discardResult: true
      })
    ).toMatchObject({ ok: true });
    const until = Date.now() + 2000;
    while (!realm.sourceModuleStatus().preparedModules && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 0));
    expect(realm.sourceModuleStatus()).toEqual({
      pendingImports: 1,
      preparedModules: 1,
      fulfilledImports: 0,
      rejectedImports: 0
    });
  } finally {
    await realm.close();
  }
  expect(budget.currentDataSize).toBe(0);
});
