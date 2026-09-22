import { expect, it } from "vitest";
import { capturedAcos } from "./captured-acos.js";

const bits = (value: number): string => {
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, value);
  return view.getBigUint64(0).toString(16).padStart(16, "0");
};

it.each([
  [0.8904620567924949, "3fde3c677ccaea1a"],
  [1, "0000000000000000"],
  [-1, "400921fb54442d18"],
  [0.125, "3ff720a392c1d955"],
  [-0.125, "3ffb235315c680dc"],
  [0.25, "3ff51700e0c14b25"],
  [-0.25, "3ffd2cf5c7c70f0c"],
  [0.5, "3ff0c152382d7366"],
  [-0.5, "4000c152382d7366"],
  [0.75, "3fe720a392c1d955"],
  [-0.75, "400359d26f93b6c3"],
  [0.921875, "3fd97744681eca44"],
  [-0.921875, "4005f312c74053d0"],
  [0.953125, "3fd3ac5c4ad70d60"],
  [-0.953125, "4006ac6fcae94b6c"],
  [0.96875, "3fd00abe0c129e1e"],
  [-0.96875, "400720a392c1d955"],
] as const)("retains native aarch64 glibc 2.41 acos rounding at %s", (input, expected) => {
  expect(bits(capturedAcos(input, { tick() {} }))).toBe(expected);
});

it.each([0, -0, Number.MIN_VALUE, -Number.MIN_VALUE])("preserves the tiny-input native constant at %s", (input) => {
  expect(bits(capturedAcos(input, { tick() {} }))).toBe("3ff921fb54442d18");
});
it.each([NaN, Infinity, -Infinity, 1.0001, -1.0001])("rejects native out-of-domain input %s", (input) => {
  expect(capturedAcos(input, { tick() {} })).toBeNaN();
});
it("observes cancellation within polynomial work", () => {
  const stop = new Error("cancelled"); let ticks = 0;
  expect(() => capturedAcos(.8904620567924949, { tick() { if (++ticks === 3) throw stop; } })).toThrow(stop);
  expect(ticks).toBe(3);
});
