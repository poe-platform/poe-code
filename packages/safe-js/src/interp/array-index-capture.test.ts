import { expect, it, vi } from "vitest";
import { measureSandboxData } from "./values.js";

it("does not reparse native array index keys during measurement", () => {
  const value = Array.from({ length: 1000 }, (_, index) => index);
  const integers = vi.spyOn(Number, "isInteger");
  try {
    expect(measureSandboxData([value])).toBe(1001);
    expect(integers.mock.calls.length).toBe(0);
  } finally { integers.mockRestore(); }
});

it("does not retain numeric values that contribute no data units", () => {
  const value = Array.from({ length: 1000 }, (_, index) => index);
  const push = Array.prototype.push;
  let units: number;
  let numericCaptures = 0;
  Array.prototype.push = function (this: unknown[], ...args: unknown[]) {
    if (args.length === 1 && typeof args[0] === "number") numericCaptures++;
    return Reflect.apply(push, this, args);
  };
  try {
    units = measureSandboxData([value]);
  } finally { Array.prototype.push = push; }
  expect(units).toBe(1001);
  expect(numericCaptures).toBe(0);
});

it("preserves string, bigint, symbol and nested-object charges", () => {
  expect(measureSandboxData([["abc", 0, null, undefined, true, 15n, Symbol("k"), { x: "y" }]])).toBe(19);
});

it("stops unmanaged index capture at length without including named numeric-looking keys", () => {
  const value = ["abc"];
  for (const key of ["00", "-0", "1e0", "4294967295", "9007199254740991", "extra"]) {
    Object.defineProperty(value, key, { value: "not indexed" });
  }
  expect(measureSandboxData([value])).toBe(5);
});

it("captures the last possible array index without visiting its holes", () => {
  const value = new Array(4294967295);
  value[4294967294] = "abc";
  expect(measureSandboxData([value])).toBe(4294967299);
});
