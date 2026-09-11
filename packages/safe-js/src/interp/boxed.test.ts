import { types } from "node:util";
import { describe, expect, it } from "vitest";
import {
  boxedDataProperties,
  boxedValue,
  createSandboxBox,
  isSandboxBox,
  nativeBoxedValue,
  primitiveReceiver
} from "./boxed.js";

describe("boxed primitive storage", () => {
  it.each([7, -0, NaN, Infinity, "ab", "😀", true, false])(
    "preserves native internal slots for %s without a host prototype",
    (value) => {
      const box = createSandboxBox(value);
      expect(Object.getPrototypeOf(box)).toBeNull();
      expect(types.isBoxedPrimitive(box)).toBe(true);
      expect(isSandboxBox(box)).toBe(true);
      expect(boxedValue(box)).toBe(value);
      expect(nativeBoxedValue(box)).toBe(value);
      expect(box.valueOf).toBeUndefined();
    }
  );

  it("uses native string index descriptors and keeps extra data separate", () => {
    const box = createSandboxBox("ab");
    box.extra = 3;
    expect(Object.getOwnPropertyDescriptor(box, "0")).toEqual({
      value: "a",
      enumerable: true,
      configurable: false,
      writable: false
    });
    expect(Object.getOwnPropertyDescriptor(box, "length")).toEqual({
      value: 2,
      enumerable: false,
      configurable: false,
      writable: false
    });
    expect(boxedDataProperties(box).map(([key]) => key)).toEqual(["extra"]);
  });

  it("does not trust lookalikes or wrappers of the wrong kind", () => {
    expect(isSandboxBox({ value: 7 })).toBe(false);
    expect(() => primitiveReceiver({ value: 7 }, "number")).toThrow(TypeError);
    expect(() => primitiveReceiver(createSandboxBox("7"), "number")).toThrow(TypeError);
    expect(primitiveReceiver(createSandboxBox(7), "number")).toBe(7);
  });
});
