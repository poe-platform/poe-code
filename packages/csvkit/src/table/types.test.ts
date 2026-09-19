import { expect, test } from "vitest";
import { inferTable, columnTypeOrder } from "./types.js";

test("Number multiplication retains only the last precision-28 quiet NaN payload digits", () => {
  expect(inferTable(["a"], [["NaN123456789012345678901234567890123"], ["-NaN000123456789012345678901234567890123"]], { numberTextOnly: true }).rows).toEqual([
    [{ kind: "decimal", value: "NaN6789012345678901234567890123" }],
    [{ kind: "decimal", value: "NaN6789012345678901234567890123" }]
  ]);
});

test("Number casting admits NaN payload digits before precision truncation", () => {
  expect(() => inferTable(["a"], [["NaN12345"]], { numberTextOnly: true, maxDecimalDigits: 4 })).toThrow("Decimal admission budget exceeded");
  expect(() => inferTable(["a"], [["NaN" + "1".repeat(10001)]], { numberTextOnly: true })).toThrow("Decimal admission budget exceeded");
});

test("quiet NaN keeps the Decimal operand sign after Agate strips its outer minus", () => {
  expect(inferTable(["a"], [["--NaN123"], ["--NaN10000000000000000000000000000"]], { numberTextOnly: true }).rows).toEqual([
    [{ kind: "decimal", value: "-NaN123" }], [{ kind: "decimal", value: "-NaN" }]
  ]);
});

test("Number applies the frozen Decimal context after source sign and currency stripping", () => {
  const input = [["--1"], ["-+1"], ["$ 1"], ["1 $"], ["12345678901234567890123456785"], ["12345678901234567890123456795"], ["NaN123"], ["-NaN"]];
  expect(inferTable(["a"], input, { numberTextOnly: true }).rows).toEqual(
    ["1", "-1", "1", "1", "1.234567890123456789012345678E+28", "1.234567890123456789012345680E+28", "NaN123", "NaN"].map(value => [{ kind: "decimal", value }])
  );
});

test("TypeTester samples for inference but casts every row with source error context", () => {
  expect(() => inferTable(["a"], [["1"], ["x"]], { limit: 1 })).toThrow(
    "CastError: Can not convert value x to bool. Error at row 1 column a."
  );
  expect(() => inferTable(["a"], [["1"], ["x"]], { limit: -1 })).toThrow(
    "CastError: Can not convert value x to bool. Error at row 1 column a."
  );
});

test("source get_column_types precedence and zero-sample Text override", () => {
  expect(columnTypeOrder({})).toEqual(["Boolean", "Number", "TimeDelta", "Date", "DateTime", "Text"]);
  expect(columnTypeOrder({ dateFormat: "%Y%m%d" })).toEqual(["Boolean", "TimeDelta", "Date", "Number", "DateTime", "Text"]);
  expect(columnTypeOrder({ datetimeFormat: "%Y%m%d" })).toEqual(["Boolean", "TimeDelta", "Date", "DateTime", "Number", "Text"]);
  expect(columnTypeOrder({ numberTextOnly: true })).toEqual(["Number", "Text"]);
  expect(columnTypeOrder({ noInference: true, numberTextOnly: true })).toEqual(["Text"]);
  expect(inferTable(["a"], [["NA"], ["0"]], { limit: 0, blanks: true }).rows).toEqual([[null], ["0"]]);
});

test("no-inference Text policy preserves originals and leading zero distinctions", () => {
  const rows = [["001", " NA "], ["x", "foo"], [".", "NULL"]];
  const table = inferTable(["a", "b"], rows, { noInference: true, blanks: true, nullValues: ["FOO"], noLeadingZeroes: true });
  expect(table.rows).toEqual([["001", " NA "], ["x", null], [".", "NULL"]]);
  expect(table.rawRows).toEqual(rows);
  expect(inferTable(["a"], [["001"], ["002"]], { numberTextOnly: true, noLeadingZeroes: true }).rows).toEqual([["001"], ["002"]]);
});

test("null-only and empty columns prefer first hypothesis, and short rows pad nulls", () => {
  expect(inferTable(["a"], []).columns).toEqual([{ name: "a", type: "Boolean" }]);
  expect(inferTable(["a"], [["NA"], []]).rows).toEqual([[null], [null]]);
  expect(inferTable([], []).rows).toEqual([]);
});

test("direct typed tables retain unqualified header warning cases as blockers", () => {
  for (const [headers, rows] of [
    [["a", "a"], [["x", "y"]]], [["", "b"], [["x", "y"]]], [[], [[], []]]
  ] as const) {
    expect(() => inferTable(headers, rows, { noInference: true })).toThrow("Agate duplicate/unnamed column warning provenance");
  }
});
