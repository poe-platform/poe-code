import { expect, it } from "vitest";
import * as errors from "./errors.js";

it.each([
  ["IndexError", "index-out-of-range", "select"],
  ["KeyError", "missing-key", "select"],
  ["ValueError", "invalid-value", "usage"],
  ["TypeError", "invalid-type", "usage"],
  ["PropertyAccessError", "property-unavailable", "select"]
] as const)("exposes %s with a stable domain error category", (name, code, phase) => {
  const error = new errors[name]("Unavailable model value.");
  expect(error).toBeInstanceOf(errors.OfficeError);
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({ name, code, phase, message: "Unavailable model value." });
});
