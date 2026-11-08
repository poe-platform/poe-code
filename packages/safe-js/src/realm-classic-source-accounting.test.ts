import { expect, it, vi } from "vitest";
import { Budget, createRealm, defineExtension } from "./core.js";

it.each([
  "function retained() { return 1; }",
  "class Retained { read() { return 1; } }",
  "(function* retained() { yield 1; })()"
])("accounts for source retained by %s and releases it when unreachable", async (expression) => {
  const budget = new Budget({ dataSize: 200_000, maxSteps: 1_000_000 });
  const realm = createRealm({ classicScripts: true, budget });
  const padding = "x".repeat(20_000);
  try {
    expect(await realm.evaluate("0;")).toMatchObject({ ok: true });
    const before = budget.currentDataSize;
    expect(
      await realm.evaluate(`globalThis.saved = ${expression}; void 0; /*${padding}*/`)
    ).toMatchObject({ ok: true });
    const retained = budget.currentDataSize;
    expect(retained - before).toBeGreaterThanOrEqual(padding.length);
    expect(await realm.evaluate("globalThis.saved = undefined;")).toMatchObject({ ok: true });
    expect(retained - budget.currentDataSize).toBeGreaterThanOrEqual(padding.length);
  } finally {
    await realm.close();
  }
  expect(budget.currentDataSize).toBe(0);
});

it("does not permanently retain source without escaping values", async () => {
  const budget = new Budget({ dataSize: 200_000, maxSteps: 1_000_000 });
  const realm = createRealm({ classicScripts: true, budget });
  const padding = "x".repeat(20_000);
  try {
    expect(await realm.evaluate("0;")).toMatchObject({ ok: true });
    const before = budget.currentDataSize;
    expect(await realm.evaluate(`1; /*${padding}*/`)).toMatchObject({ ok: true });
    expect(budget.currentDataSize - before).toBeLessThan(padding.length);
  } finally {
    await realm.close();
  }
  expect(budget.currentDataSize).toBe(0);
});

it("enforces data size across distinct retained Script sources", async () => {
  const budget = new Budget({ dataSize: 100_000, maxSteps: 1_000_000 });
  const realm = createRealm({ classicScripts: true, budget });
  const padding = "x".repeat(20_000);
  let successfulSources = 0;
  let failure: unknown;
  try {
    for (let index = 0; index < 8; index++) {
      try {
        expect(
          await realm.evaluate(
            `globalThis.saved${index} = function retained() {}; void 0; /*${padding}*/`
          )
        ).toMatchObject({ ok: true });
        successfulSources++;
      } catch (error) {
        failure = error;
        break;
      }
    }
    expect(successfulSources).toBeGreaterThan(0);
    expect(successfulSources).toBeLessThan(8);
    expect(failure).toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    await expect(realm.evaluate("1;")).rejects.toThrow();
  } finally {
    await realm.close();
  }
  expect(budget.currentDataSize).toBe(0);
});

it("accounts for template-cache ownership until realm close", async () => {
  const budget = new Budget({ dataSize: 200_000, maxSteps: 1_000_000 });
  const realm = createRealm({ classicScripts: true, budget });
  const padding = "x".repeat(20_000);
  try {
    expect(await realm.evaluate("0;")).toMatchObject({ ok: true });
    const before = budget.currentDataSize;
    expect(
      await realm.evaluate(
        `globalThis.saved = ((strings) => strings)\`retained\`; void 0; /*${padding}*/`
      )
    ).toMatchObject({ ok: true });
    expect(budget.currentDataSize - before).toBeGreaterThanOrEqual(padding.length);
    expect(await realm.evaluate("globalThis.saved = undefined;")).toMatchObject({ ok: true });
    expect(budget.currentDataSize - before).toBeGreaterThanOrEqual(padding.length);
  } finally {
    await realm.close();
  }
  expect(budget.currentDataSize).toBe(0);
});

it("rejects an oversized active source before host effects", async () => {
  const effect = vi.fn();
  const budget = new Budget({ dataSize: 20_000, maxSteps: 1_000_000 });
  const realm = createRealm({ classicScripts: true, budget, bindings: { effect } });
  try {
    await expect(realm.evaluate(`effect(); /*${"x".repeat(30_000)}*/`)).rejects.toMatchObject({
      code: "budgetExceeded",
      budget: "dataSize"
    });
    expect(effect).not.toHaveBeenCalled();
  } finally {
    await realm.close();
  }
  expect(budget.currentDataSize).toBe(0);
});

it.each(["callback", "reference"] as const)(
  "preserves active-source charges across %s bridge remeasurement",
  async (kind) => {
    const budget = new Budget({ dataSize: 200_000, maxSteps: 1_000_000 });
    const observed: number[] = [];
    const extension = defineExtension({
      manifest: {
        version: 1,
        name: "classic-source-boundary",
        globals: ["observe"],
        capabilities: ["guest:retain"]
      },
      setup(context) {
        const observe = (value: unknown) => {
          observed.push(budget.currentDataSize);
          if (kind === "reference") context.releaseGuestReference(value);
        };
        return {
          globals: {
            observe: kind === "reference" ? context.retainGuestArguments(observe, 0) : observe
          }
        };
      }
    });
    const realm = createRealm({
      classicScripts: true,
      budget,
      extensions: [extension],
      grants: ["guest:retain"]
    });
    const padding = "x".repeat(20_000);
    try {
      expect(await realm.evaluate("function previous() { return 1; } void 0;")).toMatchObject({
        ok: true
      });
      const argument = kind === "callback" ? "previous" : "7";
      expect(await realm.evaluate(`observe(${argument}); void 0; /*${padding}*/`)).toMatchObject({
        ok: true
      });
      expect(observed).toHaveLength(1);
      expect(observed[0]).toBeGreaterThanOrEqual(padding.length);
    } finally {
      await realm.close();
    }
    expect(budget.currentDataSize).toBe(0);
  }
);
