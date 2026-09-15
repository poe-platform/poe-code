import { expect, it } from "vitest";
import { ConstantValues } from "./constant-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";

it("shares small integer identity across bigint and number construction", () => {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), values = new ConstantValues(meter);
  for (let n = -5; n <= 256; n++) expect(values.integer(n)).toBe(values.integer(BigInt(n)));
  for (const n of [-6, 257]) expect(values.integer(n)).not.toBe(values.integer(n));
});
it("charges lazy cache entries once and keeps caches execution-local", () => {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), values = new ConstantValues(meter);
  const first = values.integer(1), bytes = meter.usage.allocatedBytes;
  expect(values.integer(1n)).toBe(first);
  expect(meter.usage.allocatedBytes).toBe(bytes);
  expect(new ConstantValues(meter).integer(1)).not.toBe(first);
});
it("does not bypass cancellation on cache hits", () => {
  const controller = new AbortController();
  const values = new ConstantValues(new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal: controller.signal }));
  values.integer(1); controller.abort();
  expect(() => values.integer(1)).toThrow(ExecutionLimitError);
});
