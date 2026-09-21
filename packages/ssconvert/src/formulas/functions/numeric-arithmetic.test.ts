import { expect, it } from "vitest";
import { capturedExp, fusedMultiplyAdd } from "./numeric-arithmetic.js";

it("rounds the exact product and addend once across cancellation and range boundaries", () => {
  expect(fusedMultiplyAdd(1 + 2 ** -27, 1 - 2 ** -27, -1)).toBe(-(2 ** -54));
  expect(fusedMultiplyAdd(Number.MAX_VALUE, 2, -Number.MAX_VALUE)).toBe(Number.MAX_VALUE);
  expect(fusedMultiplyAdd(Number.MIN_VALUE, .5, Number.MIN_VALUE)).toBe(2 * Number.MIN_VALUE);
  expect(fusedMultiplyAdd(Number.MIN_VALUE, .5, 0)).toBe(0);
  expect(Object.is(fusedMultiplyAdd(-Number.MIN_VALUE, .5, -0), -0)).toBe(true);
  expect(fusedMultiplyAdd(1e308, 2, -Infinity)).toBe(-Infinity);
  expect(fusedMultiplyAdd(Infinity, 0, 1)).toBeNaN();
});
it.each([
  [-0, 1, -0, -0],
  [0, -1, -0, -0],
  [-0, -1, -0, 0],
  [0, 1, -0, 0],
  [0, Number.MAX_VALUE, Number.MIN_VALUE, Number.MIN_VALUE],
  [Number.MIN_VALUE, 1, 0, Number.MIN_VALUE],
  [Number.MIN_VALUE, .5, -0, 0],
  [-Number.MIN_VALUE, .5, 0, -0],
  [Number.MAX_VALUE, 2, 0, Infinity],
])("preserves exact zero-product/addend rounding for %s * %s + %s", (a, b, addend, expected) => {
  expect(Object.is(fusedMultiplyAdd(a!, b!, addend!), expected)).toBe(true);
});
it("preserves the captured exponential's normal, subnormal and overflow boundaries", () => {
  expect(capturedExp(-1)).toBe(.36787944117144233);
  expect(capturedExp(-740)).toBe(4.2e-322);
  expect(capturedExp(-745)).toBe(Number.MIN_VALUE);
  expect(capturedExp(-746)).toBe(0);
  expect(capturedExp(709.7)).toBe(1.6549840276802644e308);
  expect(capturedExp(710)).toBe(Infinity);
  expect(capturedExp(-Infinity)).toBe(0);
  expect(capturedExp(Infinity)).toBe(Infinity);
  expect(capturedExp(NaN)).toBeNaN();
});
