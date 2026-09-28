import { expect, test } from "vitest";
import { validateTraceLimits } from "../src/browser-trace-budget.js";

test("trace limits default individually to Infinity and accept explicit Infinity", () => {
  expect(validateTraceLimits({})).toEqual({ maxBytes: Infinity, maxFiles: Infinity, maxArchiveBytes: Infinity });
  expect(validateTraceLimits({ maxFiles: 2 })).toEqual({ maxBytes: Infinity, maxFiles: 2, maxArchiveBytes: Infinity });
  expect(validateTraceLimits({ maxBytes: Infinity, maxFiles: Infinity, maxArchiveBytes: Infinity })).toEqual({ maxBytes: Infinity, maxFiles: Infinity, maxArchiveBytes: Infinity });
});
test.each([0, -1, NaN, -Infinity, 1.5])("rejects invalid trace limit %s", maxBytes => {
  expect(() => validateTraceLimits({ maxBytes })).toThrow(TypeError);
});
