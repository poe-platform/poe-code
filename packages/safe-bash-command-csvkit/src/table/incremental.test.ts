import { expect, test } from "vitest";
import { inferTable, TableInference } from "./types.js";

test("incremental inference preserves every hypothesis and late type changes", () => {
  const headers = ["number", "date", "mixed", "empty"];
  const rows = [["1", "2020-01-01", "1", ""], ["2.25", "2020-02-29", "word", "null"], ["100000000000000000000000001", "2021-01-01", "yes", "."]];
  for (const options of [{}, { noInference: true }, { dateFormat: "%Y-%m-%d" }, { numberTextOnly: true }, { blanks: true }]) {
    const inference = new TableInference(headers, options);
    for (const row of rows) inference.observe(row);
    const expected = inferTable(headers, rows, options);
    expect(inference.columns()).toEqual(expected.columns);
    expect(rows.map((row, index) => inference.cast(row, index))).toEqual(expected.rows);
  }
});

test("incremental inference does not retain mutable input rows", () => {
  const inference = new TableInference(["n"]);
  const row = ["1"];
  for (let n = 0; n < 10000; n++) { row[0] = String(n); inference.observe(row); }
  row[0] = "changed";
  expect(inference.columns()).toEqual([{ name: "n", type: "Number" }]);
  expect(inference.cast(["2.5"], 0)).toEqual([{ kind: "decimal", value: "2.5" }]);
  expect(() => inference.cast(["1", "2"], 17)).toThrow("Row 17 has 2 values");
});
