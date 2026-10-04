import {expect, it} from "vitest";
import {wrapPrintLine} from "./wrap-lines.js";

it.each([
  ["alpha beta gamma", 6, ["alpha", "beta", "gamma"]],
  ["abcdefgh", 3, ["ab", "cd", "ef", "gh"]],
  ["alpha-beta", 6, ["alpha-", "beta"]],
  ["a  b", 2, ["a", "b"]],
  ["a\u0301bc", 1, ["a\u0301", "b", "c"]],
  ["", 1, [""]]
] as const)("wraps %s without splitting graphemes", (value, width, expected) => {
  expect(wrapPrintLine(value, width, text => Array.from(new Intl.Segmenter("und", {granularity: "grapheme"}).segment(text)).length, () => {}).map(line => line.text)).toEqual(expected);
});
it("charges wrapping work and propagates cancellation", () => {
  const reason = new Error("stop");
  expect(() => wrapPrintLine("a long string", 2, text => text.length, () => {throw reason;})).toThrow(reason);
});

it("does not insert word hyphens in punctuation", () => {
  expect(wrapPrintLine("...,,,,...", 4, text => text.length, () => {}).every(line => !line.hyphen)).toBe(true);
});
it("draws discretionary hyphens only at selected line breaks", () => {
  const measure = (text: string) => text.split("­").join("").length;
  expect(wrapPrintLine("extra­ordinary", 8, measure, () => {})).toEqual([
    {text: "extra­", hyphen: true}, {text: "ordinary", hyphen: false}
  ]);
});

it("does not insert hyphens after Common-script digits", () => {
  expect(wrapPrintLine("123456789", 4, text => text.length, () => {})).toEqual([
    {text: "1234", hyphen: false}, {text: "5678", hyphen: false}, {text: "9", hyphen: false}
  ]);
});
