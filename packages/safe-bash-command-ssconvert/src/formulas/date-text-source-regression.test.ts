import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = {
  signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 1, operations: 100, workbookWork: 10000 },
  own() {}
};
// Released src/number-match.c: re_yyyymmdd3, re_mmddyyyy, handle_year and got_date.
// Calendar facts and cutoff controls are independent of the product date helpers.
it.each(["1900", "1904"] as const)("coerces released numeric date spellings under %s", dateSystem => {
  const formulas = [
    '=DATEVALUE("2024/2-29")', '=DATEVALUE("2/29/2024")',
    '=YEAR("1/2/29")', '=YEAR("1/2/30")',
    '=DAY("2024-02-29 25:00:00")', '=DAY("2024-03-01 -1:00:00")',
    '=YEAR("2024/2/30")', '=YEAR("13/1/2024")', '=YEAR("2024-02-29 garbage")',
    '=YEAR("2024-02-29 2024-03-01 12:00:00")', '=YEAR("0001-01-01")',
    '=HOUR("2024-02-29 1230")', '=SECOND("2024-02-29 123045")',
    '=HOUR("2024-02-29 12:00:00.")', '=SECOND("2024-02-29 30.0")',
    '=MINUTE("2024-02-29 1230.5")', '=HOUR("2024-02-29 123045.5")',
    '=HOUR("2024-02-29 1pm")', '=HOUR("2024-02-29 1.5pm")',
    '=HOUR("2024-02-29 1:30.5pm")'
  ];
  const result = recalculateWorkbook({ dateSystem, sheets: [{ id: "s", name: "S", cells: formulas.map((formula, row) => ({
    row, column: 0, formula, formulaDirty: true, value: { kind: "number" as const, value: 0 }
  })) }] }, context);
  expect(result.sheets[0]!.cells.map(cell => cell.value)).toEqual([
    { kind: "number", value: dateSystem === "1900" ? 45351 : 43889 },
    { kind: "number", value: dateSystem === "1900" ? 45351 : 43889 },
    { kind: "number", value: 2029 }, { kind: "number", value: 1930 },
    { kind: "error", value: "#VALUE!" }, { kind: "error", value: "#VALUE!" },
    { kind: "error", value: "#VALUE!" }, { kind: "error", value: "#VALUE!" },
    { kind: "error", value: "#VALUE!" }, { kind: "error", value: "#VALUE!" },
    { kind: "error", value: "#VALUE!" }, { kind: "number", value: 12 },
    { kind: "number", value: 45 }, { kind: "number", value: 12 },
    { kind: "number", value: 30 }, { kind: "number", value: 12 },
    { kind: "number", value: 12 }, { kind: "number", value: 13 },
    { kind: "error", value: "#VALUE!" }, { kind: "error", value: "#VALUE!" }
  ]);
});
