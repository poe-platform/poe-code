import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { CodePointString } from "./code-point-string.js";

it("checks only the affix without allocating or scanning a long receiver", () => {
  const text = new CodePointString(new Uint32Array(10000).fill(97)), needle = new CodePointString(new Uint32Array([98]));
  const meter = new ExecutionBudget({ maxSteps: 10, maxAllocatedBytes: 0 });
  expect(text.hasAffix(needle, "start", 0n, null, meter)).toBe(false);
  expect(text.hasAffix(needle, "end", 0n, null, meter)).toBe(false);
});
