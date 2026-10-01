import { expect, it } from "vitest";
import { integer } from "./cli/parser.js";

it("parses integers beyond the former default digit ceiling", () => {
  const digits = "1".repeat(4301);
  expect(integer(digits)).toBe(BigInt(digits));
  expect(integer(digits, Infinity)).toBe(BigInt(digits));
});

it("enforces explicit digit limits after normalizing signs, separators and Unicode digits", () => {
  expect(integer(" -١_٢٣ ", 3)).toBe(-123);
  expect(integer(" -١_٢٣ ", 2)).toBeUndefined();
  expect(integer("0001", 3)).toBeUndefined();
  expect(integer("12_", Infinity)).toBeUndefined();
});
