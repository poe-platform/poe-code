import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import {
  createIntrinsicArray,
  markDescriptorObject,
  trackedArrayElementData
} from "./object-model.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";

it("reuses immutable scalar totals and ordered references until an indexed write", () => {
  const child = { text: "old" };
  const symbol = Symbol("element");
  const array = createIntrinsicArray(["abc", 7, child, null, symbol, 255n]);
  const first = trackedArrayElementData(array)!;
  expect(first.units).toBe(3);
  expect(first.references).toEqual([child, symbol, 255n]);
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first.references)).toBe(true);
  expect(trackedArrayElementData(array)).toBe(first);
  array[0] = "changed";
  const next = trackedArrayElementData(array)!;
  expect(next).not.toBe(first);
  expect(next.units).toBe(7);
  expect(first.units).toBe(3);
  expect(trackedArrayElementData([])).toBeUndefined();
  expect(trackedArrayElementData(new Proxy(array, {}))).toBeUndefined();
});

it("preserves holes, hidden indices, accessors and ignored non-index fields", () => {
  const plain = ["abc", "removed", "xyz"];
  delete plain[1];
  Object.defineProperty(plain, "2", { enumerable: false });
  Object.defineProperty(plain, "extra", { value: "ignored" });
  const array = createIntrinsicArray(plain);
  expect(trackedArrayElementData(array)).toEqual({ units: 6, references: [] });
  for (const target of [plain, array])
    Object.defineProperty(target, "1", {
      get: () => {
        throw new Error("Getter executed");
      }
    });
  expect(trackedArrayElementData(array)).toBeUndefined();
  expect(measureSandboxData([array])).toBe(measureSandboxData([plain]));
  markDescriptorObject(array);
  markDescriptorObject(plain);
  expect(measureSandboxData([array])).toBe(measureSandboxData([plain]));
});

it("keeps native inherited descriptor fields observable for accessor indices", () => {
  const array = createIntrinsicArray([]);
  Object.defineProperty(array, "0", { get: () => undefined });
  const before = measureSandboxData([array]);
  const payload = { text: "x".repeat(1000) };
  const units = measureSandboxData([payload]);
  Object.defineProperty(Object.prototype, "value", { value: payload, configurable: true });
  let after: number;
  try {
    after = measureSandboxData([array]);
  } finally {
    Reflect.deleteProperty(Object.prototype, "value");
  }
  expect(after).toBe(before + units);
});

it("invalidates a snapshot after a rejected length shrink deletes later indices", () => {
  const array = createIntrinsicArray(["first", "kept", "deleted"]);
  Object.defineProperty(array, "1", { configurable: false });
  const before = trackedArrayElementData(array)!;
  expect(before.units).toBe(16);
  expect(Reflect.defineProperty(array, "length", { value: 0 })).toBe(false);
  expect(array.length).toBe(2);
  expect(trackedArrayElementData(array)).toEqual({ units: 9, references: [] });
  expect(before.units).toBe(16);
  expect(measureSandboxData([array])).toBe(12);
});

it.each([false, true])("keeps descendants, aliases and warmed quotas live (held=%s)", (held) => {
  const child = { text: "old" };
  const array = createIntrinsicArray(["abc", child, child]);
  const before = measureSandboxData([array]);
  expect(measureSandboxData([array, child])).toBe(before);
  child.text = "x".repeat(1003);
  expect(measureSandboxData([array])).toBe(before + 1000);
  const budget = new Budget({ dataSize: before + 500 });
  const release = held ? budget.deferReconciliation() : undefined;
  try {
    expect(() => reconcileCompiledValues(budget, [array])).toThrow(
      expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    );
  } finally {
    release?.();
  }
  child.text = "old";
  array[0] = "x".repeat(1003);
  expect(measureSandboxData([array])).toBe(before + 1000);
  const scalarBudget = new Budget({ dataSize: before + 500 });
  const scalarRelease = held ? scalarBudget.deferReconciliation() : undefined;
  try {
    expect(() => reconcileCompiledValues(scalarBudget, [array])).toThrow(
      expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    );
  } finally {
    scalarRelease?.();
  }
});

it("keeps the early array snapshot when a symbol callback replaces its indices", () => {
  const array = createIntrinsicArray(["old"]);
  let change = true;
  const callback = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      if (change) {
        change = false;
        array[0] = "x".repeat(1003);
      }
      return [];
    }
  });
  Object.defineProperty(array, Symbol("callback"), { value: callback });
  const first = measureSandboxData([array]);
  expect(measureSandboxData([array])).toBe(first + 1000);
});

it("remeasures observable primitive conversions after warming the snapshot", () => {
  const array = createIntrinsicArray([255n, "abc"]);
  const before = measureSandboxData([array]);
  const convert = vi.spyOn(BigInt.prototype, "toString").mockReturnValue("xxxx");
  try {
    expect(measureSandboxData([array])).toBe(before + 2);
    expect(measureSandboxData([array])).toBe(before + 2);
    expect(convert).toHaveBeenCalledTimes(2);
  } finally {
    convert.mockRestore();
  }
});

it("keeps nested measurements and failures isolated from an outer array snapshot", () => {
  const array = createIntrinsicArray([]);
  let fail = true;
  let nested: number | undefined;
  const callback = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      if (fail) throw new Error("capture failed");
      nested = measureSandboxData([array], { ignoreClosureCaptures: true });
      array[1] = "x".repeat(1003);
      return [];
    }
  });
  array[0] = callback;
  array[1] = "old";
  const before = measureSandboxData([array], { ignoreClosureCaptures: true });
  expect(() => measureSandboxData([array])).toThrow("capture failed");
  fail = false;
  expect(measureSandboxData([array])).toBe(before);
  expect(nested).toBe(before);
  expect(measureSandboxData([array])).toBe(before + 1000);
});

it("does not expose cached references to later native array iterator hooks", () => {
  const child = { text: "x".repeat(1000) };
  const array = createIntrinsicArray([child]);
  const before = measureSandboxData([array]);
  const iterator = Array.prototype[Symbol.iterator];
  let after: number;
  Array.prototype[Symbol.iterator] = function () {
    return iterator.call(Object.isFrozen(this) && this[0] === child ? [] : this);
  };
  try {
    after = measureSandboxData([array]);
  } finally {
    Array.prototype[Symbol.iterator] = iterator;
  }
  expect(after).toBe(before);
});
