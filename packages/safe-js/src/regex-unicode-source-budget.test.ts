import { expect, it } from "vitest";
import { Budget, createRealm } from "./core.js";

const expression = 'new RegExp("[" + "\\\\u0061".repeat(2136) + "]")';
async function evaluate(
  options: ConstructorParameters<typeof Budget>[0],
  source = `return ${expression}.source.length;`
) {
  const budget = new Budget({
    stringLength: 32768,
    dataSize: 262144,
    maxSteps: 2000000,
    ...options
  });
  const realm = createRealm({ budget });
  try {
    return await realm.evaluate(source).catch((error) => ({ ok: false, error }));
  } finally {
    await realm.close();
    expect(budget.currentDataSize).toBe(0);
  }
}

it("admits a bounded expanded Unicode class with selected source and allocation allowances", async () => {
  expect(
    await evaluate({
      regexSourceLength: 16384,
      regexCompileAllocations: 65536
    })
  ).toMatchObject({ ok: true, returnValue: 12818 });
});

it.each([8192])(
  "preserves the default or smaller selected source bound %s",
  async (regexSourceLength) => {
    expect(
      await evaluate({
        ...(regexSourceLength === undefined ? {} : { regexSourceLength }),
        regexCompileAllocations: 65536
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: "budgetExceeded",
        budget: "stringLength",
        limit: regexSourceLength
      }
    });
  }
);

it("rejects source beyond the enlarged ceiling", async () => {
  expect(
    await evaluate(
      { regexSourceLength: 16384, regexCompileAllocations: 65536 },
      'return new RegExp("["+"\\\\u0061".repeat(2731)+"]").source.length;'
    )
  ).toMatchObject({
    ok: false,
    error: { code: "budgetExceeded", budget: "stringLength", limit: 16384 }
  });
});

it("leaves omitted compile quotas unlimited", async () => {
  expect(await evaluate({ regexSourceLength: 16384 })).toMatchObject({
    ok: true, returnValue: 12818
  });
});

it.each([
  { dataSize: 1024, budget: "dataSize" },
  { maxSteps: 1000, budget: "steps" }
])("keeps $budget failures fatal despite guest catch", async ({ budget, ...options }) => {
  expect(
    await evaluate(
      {
        regexSourceLength: 16384,
        regexCompileAllocations: 65536,
        ...options
      },
      `try { ${expression}; }catch(error){} return 1;`
    )
  ).toMatchObject({ ok: false, error: { code: "budgetExceeded", budget } });
});

it("leaves omitted regex depth limits unlimited", async () => {
  expect(
    await evaluate(
      { regexSourceLength: 16384, regexCompileAllocations: 65536 },
      'return new RegExp("(".repeat(65)+"a"+")".repeat(65)).test("a");'
    )
  ).toMatchObject({
    ok: true, returnValue: true
  });
});

it("keeps source ceilings shared across budget views", () => {
  const budget = new Budget({
    regexSourceLength: 16384,
    regexCompileAllocations: 65536
  });
  expect(budget.forkRealm().limits).toBe(budget.limits);
  expect(Object.isFrozen(budget.limits)).toBe(true);
});
