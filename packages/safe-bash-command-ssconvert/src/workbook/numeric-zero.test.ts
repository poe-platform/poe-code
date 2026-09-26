import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { snapshotWorkbook } from "./model.js";
import { recalculateWorkbook } from "./updates/recalculation.js";

const limits = { inputBytes: 10000, outputBytes: 10000, cells: 10, sheets: 3, operations: 20 };
const number = (value: number) => ({ kind: "number" as const, value });

it("normalizes stored numeric zero without mutating caller values or numeric metadata", () => {
  const book: Workbook = {
    sheets: [{ id: "s", name: "Sheet", cells: [
      { row: 0, column: 0, value: number(-0), cachedResult: number(-0) },
      ...["=ATAN2(-1,A1)", "=IMARGUMENT(A1)", "=REDUCEPI(A1,0)"].map((formula, index) =>
        ({ row: 0, column: index + 1, formula, formulaDirty: true, value: number(9) }))
    ] }],
    detachedSheets: [{ id: "d", name: "Detached", cells: [{ row: 0, column: 0, value: number(-0) }] }],
    properties: { originalZero: -0 }
  };
  const owned = snapshotWorkbook(book, limits);
  expect(owned.sheets[0]!.cells[0]!.value).toEqual(number(0));
  expect(owned.sheets[0]!.cells[0]!.cachedResult).toEqual(number(0));
  expect(owned.detachedSheets![0]!.cells[0]!.value).toEqual(number(0));
  expect(Object.is(owned.properties!.originalZero, -0)).toBe(true);
  expect(book.sheets[0]!.cells[0]!.value).toEqual(number(-0));
  expect(book.sheets[0]!.cells[0]!.cachedResult).toEqual(number(-0));
  expect(Object.isFrozen(owned)).toBe(true);
  expect(Object.isFrozen(owned.sheets)).toBe(true);
  expect(Object.isFrozen(owned.sheets[0]!.cells)).toBe(true);
  expect(Object.isFrozen(owned.sheets[0]!.cells[0]!.value)).toBe(true);
  const context: CapabilityContext = { limits, signal: new AbortController().signal, own() {},
    environment: { env: {}, locale: "C", timezone: "UTC" } };
  expect(recalculateWorkbook(owned, context, true).sheets[0]!.cells.slice(1).map(cell => cell.value))
    .toEqual([number(Math.PI), number(0), number(0)]);
});

it.each([false, true])("normalizes authorized external numeric zero (array=%s)", array => {
  const supplied = number(-0);
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
    "=ATAN2(-1,'[authorized.xls]Sheet1'!A1)",
    "=IMARGUMENT('[authorized.xls]Sheet1'!A1)",
    "=REDUCEPI('[authorized.xls]Sheet1'!A1,0)"
  ].map((formula, column) => ({ row: 0, column, formula, formulaDirty: true, value: number(9) })) }] };
  const context: CapabilityContext = { limits, signal: new AbortController().signal, own() {},
    environment: { env: {}, locale: "C", timezone: "UTC" },
    externalReferences: { resolve() { return array ? { kind: "array", rows: [[supplied]] } : supplied; } } };
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(cell => cell.value))
    .toEqual([number(Math.PI), number(0), number(0)]);
  expect(Object.is(supplied.value, -0)).toBe(true);
});
