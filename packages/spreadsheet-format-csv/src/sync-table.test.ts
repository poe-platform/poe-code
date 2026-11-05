import { expect, it } from "vitest";
import { formatSimpleCsv, parseSimpleSeparatedRows } from "./sync-table.js";

it.each([
  ["a,\n1,\n", "a\n1\n"],
  ['a,,""\n1,,\n', "a\n1\n"],
  ["a,b\n1,2\n", "a,b\n1,2\n"],
  ["a,b\n\n1,2\n", "a,b\n,\n1,2\n"],
  ["\na,b\n\n\n1,2\n", ",\na,b\n,\n,\n1,2\n"],
  ["a,,c,\n1,,,\n", "a,,c\n1,,\n"],
  ["a,\n1,2\n", "a,\n1,2\n"],
  ["a\n1,2\n", "a,\n1,2\n"]
])("exports the populated sheet width for %j", (input, expected) => {
  expect(formatSimpleCsv(parseSimpleSeparatedRows(input, ",")!)).toBe(expected);
});

it("preserves typed values and ignores blank cells when measuring width", () => {
  expect(formatSimpleCsv([
    [{ kind: "number", value: 0 }, { kind: "blank" }],
    [{ kind: "boolean", value: false }]
  ])).toBe("0\nFALSE\n");
});
