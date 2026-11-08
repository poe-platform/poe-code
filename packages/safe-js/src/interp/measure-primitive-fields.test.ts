import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { createSandboxClosure, measureSandboxData } from "./values.js";

it("keeps string-field charges when host snapshot hooks omit primitive values", () => {
  const payload = "x".repeat(1000);
  const root = { payload };
  const original = Array.prototype.push;
  let measured: number;
  try {
    Array.prototype.push = function (...items: unknown[]) {
      if (items.length === 1 && items[0] === payload) return this.length;
      return Reflect.apply(original, this, items);
    };
    measured = measureSandboxData([root]);
  } finally {
    Array.prototype.push = original;
  }
  expect(measured).toBe(1009);
  expect(() => new Budget({ dataSize: 500 }).reconcileDataUsage(measured)).toThrow(
    expect.objectContaining({ budget: "dataSize" })
  );
});

it("captures string fields before reference descendants mutate them", () => {
  const root = {
    child: createSandboxClosure({
      call: () => undefined,
      retainedValues: () => {
        root.payload = "x".repeat(1000);
        return [];
      }
    }),
    payload: "a"
  };
  expect(measureSandboxData([root])).toBe(17);
  expect(measureSandboxData([root])).toBe(1016);
});

it("preserves property-key charges for inert primitive fields", () => {
  expect(measureSandboxData([{ number: 7, bool: true, nil: null, missing: undefined }])).toBe(25);
});

it("preserves bigint observation after all field descriptors are captured", () => {
  const root = { integer: 15n, payload: "a" };
  const original = BigInt.prototype.toString;
  let first: number;
  let second: number;
  try {
    BigInt.prototype.toString = function (radix?: number) {
      root.payload = "x".repeat(1000);
      return Reflect.apply(original, this, [radix]);
    };
    first = measureSandboxData([root]);
    second = measureSandboxData([root]);
  } finally {
    BigInt.prototype.toString = original;
  }
  expect(first).toBe(19);
  expect(second).toBe(1018);
});
