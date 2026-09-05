import { describe, expect, it } from "vitest";
import { Budget, createRealm, run } from "../core.js";
import { parse } from "../parse.js";
import { interpret } from "./interpreter.js";

describe("interpreter retained-root accounting", () => {
  it.each([
    [["x".repeat(100)], 100],
    [["x".repeat(100), "y".repeat(25)], 125],
    [["x".repeat(50), "x".repeat(50)], 100]
  ] as const)("counts each registered string root once: %j", async (values, expected) => {
    const budget = new Budget({ dataSize: 150 });
    const realm = createRealm({ budget });
    const owners = values.map(() => ({}));
    for (const [index, owner] of owners.entries()) budget.setRetainedValues(owner, () => [values[index]]);
    try {
      expect(await realm.evaluate("return 7")).toMatchObject({ ok: true, returnValue: 7 });
      expect(budget.peakDataSize).toBe(expected);
    } finally {
      for (const owner of owners) budget.setRetainedValues(owner, undefined);
      await realm.close();
    }
  });

  it.each([
    "return 7",
    "function value(){return 7}return value()",
    "async function value(){return 7}return await value()"
  ])("counts registered roots once when a public run completes: %s", async (source) => {
    const budget = new Budget({ dataSize: 3500 });
    const owner = {};
    try {
      expect(await run(`retain();${source}`, {
        budget,
        bindings: {
          retain: () => { budget.setRetainedValues(owner, () => ["x".repeat(2000)]); }
        }
      })).toMatchObject({ ok: true, returnValue: 7 });
      expect(budget.peakDataSize).toBeGreaterThanOrEqual(2000);
      expect(budget.peakDataSize).toBeLessThanOrEqual(3500);
    } finally {
      budget.setRetainedValues(owner, undefined);
    }
  });

  it("still rejects a single retained root above the limit", async () => {
    const budget = new Budget({ dataSize: 99 });
    const owner = {};
    budget.setRetainedValues(owner, () => ["x".repeat(100)]);
    try {
      await expect(interpret(parse("return 7"), { budget }))
        .rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize", current: 100, limit: 99 });
    } finally {
      budget.setRetainedValues(owner, undefined);
    }
  });

  it.each([
    "return (()=>7)()",
    "function value(){return 7}return value()",
    "async function value(){return 7}return await value()",
    "return Number({valueOf(){return 7}})"
  ])("counts registered roots once when a guest closure completes: %s", async (source) => {
    const budget = new Budget({ dataSize: 500 });
    const realm = createRealm({ budget });
    const owner = {};
    budget.setRetainedValues(owner, () => ["x".repeat(300)]);
    try {
      expect(await realm.evaluate(source)).toMatchObject({ ok: true, returnValue: 7 });
      expect(budget.peakDataSize).toBeGreaterThanOrEqual(300);
      expect(budget.peakDataSize).toBeLessThanOrEqual(500);
    } finally {
      budget.setRetainedValues(owner, undefined);
      await realm.close();
    }
  });
});
