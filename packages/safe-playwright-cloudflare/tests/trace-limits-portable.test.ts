import { expect, test } from "vitest";
import { validateTraceLimits } from "../src/browser-trace-budget.js";

test("trace limits default individually to Infinity and accept explicit Infinity", () => {
  expect(validateTraceLimits({})).toEqual({ maxBytes: Infinity, maxFiles: Infinity, maxArchiveBytes: Infinity, maxPathBytes: Infinity, maxDepth: Infinity, maxPaxBytes: Infinity, maxTextBytes: Infinity });
  expect(validateTraceLimits({ maxFiles: 2 })).toEqual({ maxBytes: Infinity, maxFiles: 2, maxArchiveBytes: Infinity, maxPathBytes: Infinity, maxDepth: Infinity, maxPaxBytes: Infinity, maxTextBytes: Infinity });
  expect(validateTraceLimits({ maxBytes: Infinity, maxFiles: Infinity, maxArchiveBytes: Infinity, maxPathBytes: Infinity, maxDepth: Infinity, maxPaxBytes: Infinity, maxTextBytes: Infinity })).toEqual({ maxBytes: Infinity, maxFiles: Infinity, maxArchiveBytes: Infinity, maxPathBytes: Infinity, maxDepth: Infinity, maxPaxBytes: Infinity, maxTextBytes: Infinity });
});
test.each([0, -1, NaN, -Infinity, 1.5])("rejects invalid trace limit %s", maxBytes => {
  expect(() => validateTraceLimits({ maxBytes })).toThrow(TypeError);
});

test("an omitted trace quota defaults to Infinity while null remains invalid", () => {
  expect(validateTraceLimits({ maxBytes: undefined }).maxBytes).toBe(Infinity);
  expect(() => validateTraceLimits({ maxBytes: null as never })).toThrow(TypeError);
});
