import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { createSandboxTemporalPlainTime } from "./temporal-plain-time.js";
import { cloneSandboxValue, cloneStructuredGraph, measureSandboxData } from "./values.js";

it("accounts for all six private numbers once across aliases", () => {
  const value = createSandboxTemporalPlainTime({ hour: 23, nanosecond: 999 });
  expect(measureSandboxData([value])).toBe(49);
  expect(measureSandboxData([value, value])).toBe(49);
  expect(measureSandboxData([value, createSandboxTemporalPlainTime()])).toBe(98);
});

it("enforces the exact retained-data boundary for a PlainTime", () => {
  const value = createSandboxTemporalPlainTime();
  expect(() => new Budget({ dataSize: 49 }).reconcileDataUsage(measureSandboxData([value]))).not.toThrow();
  expect(() => new Budget({ dataSize: 48 }).reconcileDataUsage(measureSandboxData([value]))).toThrow();
});

it.each([false, true])("rejects SDK structured cloning before reading properties (nested: %s)", nested => {
  const value = createSandboxTemporalPlainTime();
  let reads = 0;
  Object.defineProperty(value, "label", { enumerable: true, get() { reads++; return 7; } });
  expect(() => cloneSandboxValue(nested ? { value } : value, { structuredClone: true }))
    .toThrow(expect.objectContaining({ name: "DataCloneError" }));
  expect(reads).toBe(0);
});

it("rejects interpreter structured serialization before yielding a guest getter request", () => {
  const value = createSandboxTemporalPlainTime();
  Object.defineProperty(value, "label", { enumerable: true, get() { throw new Error("getter ran"); } });
  const serialization = cloneStructuredGraph(value, { seen: new WeakMap() }, new Budget());
  expect(() => serialization.next()).toThrow(expect.objectContaining({ name: "DataCloneError" }));
});
