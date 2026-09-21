import { expect, it } from "vitest";
import { formatText } from "./number-format.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 100000 }, own() {}
};

const host = { context, book: {}, tick() { context.signal.throwIfAborted(); } };

it.each([
  [1.25, 101, "1.25" + "0".repeat(99) + "E+00"],
  [0, 120, "0." + "0".repeat(120) + "E+00"],
  [-1.25, 101, "-1.25" + "0".repeat(99) + "E+00"],
  [12.5, 101, "1.25" + "0".repeat(99) + "E+01"]
] as const)("renders native scientific precision above 100 (%s, %s)", (value, precision, expected) => {
  expect(formatText({ kind: "number", value }, "0." + "0".repeat(precision) + "E+00", host))
    .toEqual({ kind: "string", value: expected });
});
