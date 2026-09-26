import { expect, it } from "vitest";
import { capturedLog1p } from "./captured-log1p.js";

const bits = (value: number): string => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return view.getBigUint64(0).toString(16).padStart(16, "0");
};
it.each([
  [0.33688260287586475, "3fd294f0450c0973"],
  [0.5970989573261564, "3fddf6ce4a42bd55"],
  [0.22690015107295408, "3fca2cc10afdeaf1"]
] as const)("retains compiled aarch64 glibc 2.41 log1p rounding at %s", (input, expected) => {
  expect(bits(capturedLog1p(input))).toBe(expected);
});
