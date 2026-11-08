import {expect, it} from "vitest";
import {printBidiRuns} from "./bidi-runs.js";

it.each([
  ["ab\u200bאב", "rtl", [{text: "אב", direction: "rtl"}, {text: "ab\u200b", direction: "ltr"}]],
  ["אב\u200bab", "ltr", [{text: "אב\u200b", direction: "rtl"}, {text: "ab", direction: "ltr"}]],
  ["אבab", "rtl", [{text: "ab", direction: "ltr"}, {text: "אב", direction: "rtl"}]],
  ["abאב", "ltr", [{text: "ab", direction: "ltr"}, {text: "אב", direction: "rtl"}]],
  ["😀אב", "ltr", [{text: "😀", direction: "ltr"}, {text: "אב", direction: "rtl"}]],
  ["", "rtl", []]
] as const)("itemizes %s in %s visual order without reversing logical run text", (text, direction, expected) => {
  expect(printBidiRuns(text, direction, () => {})).toEqual(expected);
});

it("reserves bounded bidi work before processing", () => {
  const error = new Error("cancelled");
  expect(() => printBidiRuns("אבab", "rtl", amount => {
    expect(amount).toBeGreaterThanOrEqual(4 * 128);
    throw error;
  })).toThrow(error);
});
