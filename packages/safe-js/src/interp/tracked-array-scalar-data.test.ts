import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { createIntrinsicArray, trackedArrayElementData } from "./object-model.js";
import { measureSandboxData, reconcileCompiledValues } from "./values.js";

it("keeps scalar append accounting linear in descriptor observations", async () => {
  vi.resetModules();
  const descriptor = Object.getOwnPropertyDescriptor;
  let counting = false;
  let reads = 0;
  Object.getOwnPropertyDescriptor = (target, key) => {
    if (counting && Array.isArray(target)) reads++;
    return descriptor(target, key);
  };
  try {
    const model = await import("./object-model.js");
    Object.getOwnPropertyDescriptor = descriptor;
    const array = model.createIntrinsicArray();
    counting = true;
    for (let index = 0; index < 128; index++) {
      array.push(index % 2 === 0 ? index : "abc");
      const data = model.trackedArrayElementData(array)!;
      expect(data.units).toBe(Math.floor((index + 1) / 2) * 3);
      expect(data.references).toHaveLength(0);
    }
    counting = false;
    // Allow a constant number of observations per write, including push's
    // length update; rebuilding every growing prefix exceeds this bound.
    expect(reads).toBeLessThan(128 * 10);
  } finally {
    counting = false;
    Object.getOwnPropertyDescriptor = descriptor;
  }
});

it.each([false, true])("charges scalar mutations and failed length truncation (held=%s)", held => {
  const array = createIntrinsicArray(["a", "bb", "ccc", "dddd"]);
  Object.defineProperty(array, "1", { configurable: false, enumerable: false });
  expect(trackedArrayElementData(array)?.units).toBe(10);
  expect(Reflect.defineProperty(array, "length", { value: 0 })).toBe(false);
  expect(array.length).toBe(2);
  expect(trackedArrayElementData(array)?.units).toBe(3);
  array[0] = "x".repeat(1001);
  expect(trackedArrayElementData(array)?.units).toBe(1003);
  const budget = new Budget({ dataSize: 500 });
  const release = held ? budget.deferReconciliation() : undefined;
  try {
    expect(() => reconcileCompiledValues(budget, [array])).toThrowError(
      expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    );
  } finally {
    release?.();
  }
});

it("keeps indexed references and accessors on the fresh snapshot path", () => {
  const array = createIntrinsicArray(["abc", 1]);
  const initial = trackedArrayElementData(array)!;
  const child = { text: "small" };
  array[1] = child;
  expect(trackedArrayElementData(array)?.references).toEqual([child]);
  const before = measureSandboxData([array]);
  child.text = "x".repeat(1005);
  expect(measureSandboxData([array])).toBe(before + 1000);
  Object.defineProperty(array, "1", { get: () => child, configurable: true });
  expect(trackedArrayElementData(array)).toBeUndefined();
  Reflect.deleteProperty(array, "1");
  expect(trackedArrayElementData(array)?.units).toBe(3);
  expect(trackedArrayElementData(array)?.references).toHaveLength(0);
  expect(initial.units).toBe(3);
  expect(initial.references).toHaveLength(0);
});

it("ignores named array fields while preserving sparse and hidden scalar indices", () => {
  const array = createIntrinsicArray();
  Object.defineProperty(array, "7", { value: "hidden", configurable: true });
  Object.defineProperty(array, "01", { value: { text: "unmeasured" }, configurable: true });
  Object.defineProperty(array, "4294967295", { value: "unmeasured", configurable: true });
  expect(trackedArrayElementData(array)?.units).toBe(6);
  expect(trackedArrayElementData(array)?.references).toHaveLength(0);
  array.length = 100;
  expect(trackedArrayElementData(array)?.units).toBe(6);
  array.length = 3;
  expect(trackedArrayElementData(array)?.units).toBe(0);
});
