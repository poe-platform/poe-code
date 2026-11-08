import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { setSandboxPrototype } from "./object-model.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";

it.each([false, true])("keeps parent siblings across recursive prototype walks (held=%s)", held => {
  const left = { text: "x".repeat(1000) };
  const right = { text: "y".repeat(2000) };
  const tail = { text: "z".repeat(4000) };
  const closure = createSandboxClosure({ call: () => undefined, retainedValues: () => [left] });
  setSandboxPrototype(closure, { left, right });
  const owner = [closure, tail];
  expect(measureSandboxData([owner])).toBe(7047);
  expect(measureSandboxData([owner, left, tail])).toBe(7047);
  tail.text += "grown";
  expect(measureSandboxData([owner])).toBe(7052);
  const budget = new Budget({ dataSize: 7048 });
  const release = held ? budget.deferReconciliation() : undefined;
  try {
    expect(() => reconcileCompiledValues(budget, [owner])).toThrowError(
      expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    );
  } finally {
    release?.();
  }
});

it("isolates a reentrant measurement while parent continuation frames are pending", () => {
  const child = { text: "x".repeat(1000) };
  const tail = { text: "y".repeat(2000) };
  let nested = -1;
  const closure = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      nested = measureSandboxData([child, tail]);
      return [child];
    }
  });
  const owner = [closure, tail];
  expect(measureSandboxData([owner])).toBe(3016);
  expect(nested).toBe(3012);
  expect(measureSandboxData([owner])).toBe(3016);
});
