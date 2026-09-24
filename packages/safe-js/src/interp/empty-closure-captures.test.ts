import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";

it("does not allocate iterable fallbacks for closures without capture providers", () => {
  const closures = Array.from({ length: 32 }, () =>
    createSandboxClosure({ call: () => undefined })
  );
  const iterate = Array.prototype[Symbol.iterator];
  let emptyIterations = 0,
    units: number;
  Array.prototype[Symbol.iterator] = function () {
    if (this.length === 0) emptyIterations++;
    return iterate.call(this);
  };
  try {
    units = measureSandboxData(closures);
  } finally {
    Array.prototype[Symbol.iterator] = iterate;
  }
  expect(units).toBe(32);
  expect(emptyIterations).toBe(0);
});

it("still invokes providers and iterator overrides on empty native arrays", () => {
  const roots: string[] = [];
  let payload = "small",
    calls = 0,
    iterations = 0;
  roots[Symbol.iterator] = function* () {
    iterations++;
    yield payload;
  };
  const closure = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      calls++;
      return roots;
    }
  });
  expect(measureSandboxData([closure])).toBe(6);
  payload = "changed";
  expect(measureSandboxData([closure])).toBe(8);
  expect(calls).toBe(2);
  expect(iterations).toBe(2);
  expect(measureSandboxData([closure], { ignoreClosureCaptures: true })).toBe(1);
  expect(calls).toBe(2);
});

it.each([false, true])("keeps provider descendants fresh and enforces quotas (held=%s)", (held) => {
  const child = { text: "small" };
  const closure = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => [child, child]
  });
  const before = measureSandboxData([closure]);
  child.text = "x".repeat(1005);
  expect(measureSandboxData([closure])).toBe(before + 1000);
  const budget = new Budget({ dataSize: before + 500 });
  const release = held ? budget.deferReconciliation() : undefined;
  try {
    expect(() => reconcileCompiledValues(budget, [closure])).toThrow(
      expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    );
  } finally {
    release?.();
  }
});
