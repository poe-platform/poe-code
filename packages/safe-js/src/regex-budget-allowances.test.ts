import { expect, it } from "vitest";
import { Budget, createRealm } from "./core.js";

async function evaluate(budget: Budget, source: string) {
  const realm = createRealm({ budget });
  try {
    return await realm.evaluate(source).catch((error) => ({ ok: false, error }));
  } finally {
    await realm.close();
  }
}

it("leaves omitted regex-source limits unlimited", async () => {
  expect(
    await evaluate(
      new Budget({ stringLength: 16384 }),
      'return new RegExp("a".repeat(4097)).source.length;'
    )
  ).toMatchObject({
    ok: true, returnValue: 4097
  });
});

it("admits larger regexes only within explicitly selected source and allocation allowances", async () => {
  const budget = new Budget({
    stringLength: 16384,
    regexSourceLength: 8192,
    regexCompileAllocations: 65536
  });
  expect(
    await evaluate(budget, 'return new RegExp("a".repeat(4097)).source.length;')
  ).toMatchObject({ ok: true, returnValue: 4097 });
  expect(budget.limits).toMatchObject({ regexSourceLength: 8192, regexCompileAllocations: 65536 });
  expect(Object.isFrozen(budget.limits)).toBe(true);
});

it("leaves omitted compilation-allocation limits unlimited", async () => {
  expect(
    await evaluate(
      new Budget({ stringLength: 16384, regexSourceLength: 8192 }),
      'return new RegExp("a".repeat(4097)).source.length;'
    )
  ).toMatchObject({
    ok: true, returnValue: 4097
  });
});

it("keeps tighter general string limits effective", async () => {
  expect(
    await evaluate(
      new Budget({ stringLength: 3, regexSourceLength: 8192, regexCompileAllocations: 65536 }),
      "return /abcd/.source;"
    )
  ).toMatchObject({
    ok: false,
    error: { code: "budgetExceeded", budget: "stringLength", limit: 3 }
  });
});

it("keeps data-size and execution-work limits fatal with larger compile allowances", async () => {
  for (const [options, quota] of [
    [{ dataSize: 1024 }, "dataSize"],
    [{ maxSteps: 1000 }, "steps"]
  ] as const) {
    expect(
      await evaluate(
        new Budget({
          ...options,
          stringLength: 16384,
          regexSourceLength: 8192,
          regexCompileAllocations: 65536
        }),
        'try { new RegExp("a".repeat(4097)); } catch(e) {} return 1;'
      )
    ).toMatchObject({ ok: false, error: { code: "budgetExceeded", budget: quota } });
  }
});

it("shares selected allowances and usage across budget views", () => {
  const budget = new Budget({ regexSourceLength: 8192, regexCompileAllocations: 65536 });
  const view = budget.forkRealm();
  expect(view.limits).toBe(budget.limits);
  view.visitNode(7);
  expect(budget.stepsUsed).toBe(7);
});

it.each(["regexSourceLength", "regexCompileAllocations"] as const)(
  "rejects malformed %s",
  (name) => {
    for (const value of [
      0,
      -1,
      1.5,
      NaN,
      Infinity,
      "8192"
    ])
      expect(() => new Budget({ [name]: value } as never)).toThrow(RangeError);
  }
);
