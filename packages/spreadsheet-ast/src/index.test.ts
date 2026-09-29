import { expect, it } from "vitest";
import { snapshotWorkbook, updateWorkbook, parseA1, formatA1, SsconvertError, type Workbook } from "./index.js";

const limits = { inputBytes: 10000, outputBytes: 10000, cells: 10, sheets: 2, operations: 20 };

it("owns and edits a workbook independently of any file format", () => {
  const source: Workbook = { sheets: [{ id: "s", name: "Data", cells: [
    { row: 0, column: 0, value: { kind: "number", value: 7 } }
  ] }] };
  const owned = snapshotWorkbook(source, limits);
  const edited = updateWorkbook(owned, [
    { sheet: "s", row: 0, column: 0, value: { kind: "number", value: 9 } }
  ], limits);
  expect(owned.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
  expect(edited.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 9 });
  expect(source.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
  expect(Object.isFrozen(owned.sheets[0]!.cells[0]!.value)).toBe(true);
  const { row, column } = parseA1("$AA$12");
  expect(formatA1(row, column)).toBe("AA12");
});

it("refuses workbook accessors and storage over budget before accepting a model", () => {
  let reads = 0;
  const supplied = { get sheets() { reads++; return []; } };
  expect(() => snapshotWorkbook(supplied, limits)).toThrow("Unsupported workbook accessor");
  expect(reads).toBe(0);
  expect(() => snapshotWorkbook({ sheets: [{ id: "s", name: "Data", cells: [
    { row: 0, column: 0, value: { kind: "string", value: "retained" } }
  ] }] }, { ...limits, cells: 0 })).toThrow(SsconvertError);
});

it("preserves raw cell bytes and format metadata across model snapshots", () => {
  const source: Workbook = { sheets: [{ id: "s", name: "Data", cells: [
    { row: 0, column: 0, value: { kind: "byte-string", value: "ff8061" } },
    { row: 1, column: 0, value: { kind: "number", value: 45292, format: "yyyy-mm-dd" } }
  ] }] };
  expect(snapshotWorkbook(source, limits)).toEqual(source);
});
