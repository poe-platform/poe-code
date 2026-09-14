import { expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";

const source = "return /z/.test(input)";

it("permits the six-character scan with sufficient work budget", async () => {
  expect(
    await run(source, {
      bindings: { input: "aaaaaa" },
      budget: new Budget({ maxSteps: 102 })
    })
  ).toMatchObject({ ok: true, returnValue: false });
});

it("admits the neighboring scan at exactly the public work limit", async () => {
  const budget = new Budget({ maxSteps: 100 });
  expect(await run(source, { bindings: { input: "aaaaa" }, budget })).toMatchObject({
    ok: true,
    returnValue: false
  });
  expect(budget.stepsUsed).toBe(100);
});

it("rejects the next candidate scan and retains consumed work", async () => {
  const budget = new Budget({ maxSteps: 100 });
  await expect(run(source, { bindings: { input: "aaaaaa" }, budget })).rejects.toMatchObject({
    code: "budgetExceeded",
    budget: "steps",
    current: 101,
    limit: 100
  });
  expect(budget.stepsUsed).toBe(101);
  expect(budget.currentCallDepth).toBe(0);
  expect([...budget.retainedValues()]).toEqual([]);
});
