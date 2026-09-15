import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeValues} from "./runtime-values.js";

it.each(["", "missing", "é".repeat(200)])("admits missing-handler exception storage for %j", name => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  const values = new RuntimeValues(meter), registry = new RuntimeCodecRegistry(values, meter);
  // Leave enough for the lookup itself, but none for the exception it produces.
  meter.checkpoint(0, 1000000 - meter.usage.allocatedBytes - 32 - name.length * 2);
  let failure: unknown;
  try {registry.lookupError(name);} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  let retry: unknown;
  try {registry.lookupError(name);} catch (error) {retry = error;}
  expect(retry).toBe(failure);
});

it("does not charge exception storage for a successful retained handler lookup", () => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  const values = new RuntimeValues(meter), registry = new RuntimeCodecRegistry(values, meter);
  const handler = registry.lookupError("strict");
  const before = meter.usage.allocatedBytes;
  expect(registry.lookupError("strict")).toBe(handler);
  const lookupBytes = meter.usage.allocatedBytes - before;
  meter.checkpoint(0, 1000000 - meter.usage.allocatedBytes - lookupBytes);
  expect(registry.lookupError("strict")).toBe(handler);
});
