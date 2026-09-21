import { expect, it } from "vitest";
import { capturedTrig } from "./captured-trigonometry.js";

it.each([false, true])("propagates non-finite captured trig inputs (cosine=%s)", cosine => {
  for (const value of [NaN, Infinity, -Infinity]) expect(capturedTrig(value, cosine)).toBeNaN();
});
it("preserves captured cancellation and scalar trigonometric rounding", () => {
  expect(capturedTrig(11.180339887498949, true)).toBe(.18371612815546762);
  expect(capturedTrig(2.2337856189121656, true)).toBe(-.615475626643326);
  expect(capturedTrig(2.3857423945820133, false)).toBe(.6859076403111356);
  expect(capturedTrig(-13.814102720014475, true)).toBe(.31747374649633375);
  expect(capturedTrig(-11.41480630838971, true)).toBe(.40705909959089115);
  expect(capturedTrig(-0, false)).toBe(-0);
  expect(capturedTrig(-0, true)).toBe(1);
});
