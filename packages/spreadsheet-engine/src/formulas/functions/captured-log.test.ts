import { expect, it } from "vitest";
import { capturedLog } from "./captured-log.js";

it("preserves the native near-one fused polynomial final sum", () => {
  expect(capturedLog(0.9408035257119506)).toBe(-0.061020954276822005);
});
it("preserves logarithm domain and signed-zero behavior", () => {
  expect(capturedLog(1)).toBe(0);
  expect(capturedLog(0)).toBe(-Infinity);
  expect(capturedLog(-0)).toBe(-Infinity);
  expect(capturedLog(Infinity)).toBe(Infinity);
  expect(capturedLog(-1)).toBeNaN();
  expect(capturedLog(NaN)).toBeNaN();
});
