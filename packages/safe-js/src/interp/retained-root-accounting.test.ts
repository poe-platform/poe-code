import { describe, expect, it } from "vitest";
import { Budget, createRealm } from "../core.js";
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
});
