import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { recalculateWorkbook } from "./evaluator.js";
import type { RuntimeFunctions } from "./runtime-functions.js";

// Authenticated py-gnumeric.c:py_obj_to_gnm_value admits rectangular arrays
// and returned RangeRef values. A cooperative JS port needs both result kinds.
const context: CapabilityContext = {
  signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 4, operations: 100, workbookWork: 10000 }
};
const book = (formula: string): Workbook => ({ sheets: [{ id: "s", name: "S", cells: [
  { row: 0, column: 0, value: { kind: "number", value: 5 } },
  { row: 1, column: 0, value: { kind: "number", value: 7 } },
  { row: 0, column: 1, formula, formulaDirty: true, value: { kind: "blank" } }
] }] });

it("admits a cooperative port array result to the ordinary aggregate evaluator", () => {
  const functions = { HOST_ARRAY: { signature: "", implementation() { return { kind: "matrix", rows: [
    [{ kind: "number", value: 2 }, { kind: "number", value: 3 }],
    [{ kind: "number", value: 5 }, { kind: "number", value: 8 }]
  ] }; } } } as unknown as RuntimeFunctions;
  const result = recalculateWorkbook(book("=SUM(HOST_ARRAY())"), { ...context, runtimeFunctions: functions });
  expect(result.sheets[0]!.cells[2]!.value).toEqual({ kind: "number", value: 18 });
});
it("retains a returned range as a reference with actual host-owned cells", () => {
  const functions = { HOST_IDENTITY: { signature: "r", implementation(args: readonly unknown[]) { return args[0]; } } } as unknown as RuntimeFunctions;
  const result = recalculateWorkbook(book("=SUM(HOST_IDENTITY(A1:A2))"), { ...context, runtimeFunctions: functions });
  expect(result.sheets[0]!.cells[2]!.value).toEqual({ kind: "number", value: 12 });
});
it("owns returned matrix members before subsequent cooperative code mutates them", () => {
  const borrowed = { kind: "matrix", rows: [[{ kind: "number", value: 2 }, { kind: "number", value: 3 }]] };
  const functions = {
    HOST_ARRAY: { signature: "", implementation() { return borrowed; } },
    MUTATE: { signature: "?", implementation(args: readonly { rows: readonly (readonly { value: number }[])[] }[]) {
      borrowed.rows[0]![0]!.value = 99;
      return { kind: "number", value: args[0]!.rows[0]![0]!.value };
    } }
  } as unknown as RuntimeFunctions;
  const result = recalculateWorkbook(book("=MUTATE(HOST_ARRAY())"), { ...context, runtimeFunctions: functions });
  expect(result.sheets[0]!.cells[2]!.value).toEqual({ kind: "number", value: 2 });
});
it("lets the existing array group evaluator distribute a returned matrix", () => {
  const input = book("=HOST_ARRAY()");
  const grouped: Workbook = { ...input, sheets: input.sheets.map(sheet => ({ ...sheet,
    formulaGroups: [{ id: "g", kind: "array", expression: "=HOST_ARRAY()",
      range: { startRow: 0, endRow: 1, startColumn: 1, endColumn: 2 } }],
    cells: sheet.cells.map(cell => cell.formula ? { ...cell, formulaGroup: "g" } : cell) })) };
  const functions = { HOST_ARRAY: { signature: "", implementation() { return { kind: "matrix", rows: [
    [{ kind: "number", value: 2 }, { kind: "blank" }],
    [{ kind: "boolean", value: true }, { kind: "error", value: "#N/A" }]
  ] }; } } } as unknown as RuntimeFunctions;
  const result = recalculateWorkbook(grouped, { ...context, runtimeFunctions: functions });
  expect(result.sheets[0]!.cells.filter(cell => cell.column > 0).map(cell => [cell.row, cell.column, cell.value])).toEqual([
    [0, 1, { kind: "number", value: 2 }], [0, 2, { kind: "blank" }],
    [1, 1, { kind: "boolean", value: true }], [1, 2, { kind: "error", value: "#N/A" }]
  ]);
});

it("records returned dynamic ranges so later dirty precedents recalculate their dependents", () => {
  const functions = { HOST_REFERENCE: { signature: "", implementation(_args: unknown, host: { indirect(text: string, a1: boolean): unknown }) {
    return host.indirect("A1:A2", true);
  } } } as unknown as RuntimeFunctions;
  const first = recalculateWorkbook(book("=SUM(HOST_REFERENCE())"), { ...context, runtimeFunctions: functions });
  expect(first.dependencies).toEqual([{ dynamic: true,
    dependent: { sheet: "s", startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 },
    precedent: { sheet: "s", startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 }
  }]);
  const changed = { ...first, sheets: first.sheets.map(sheet => ({ ...sheet, cells: sheet.cells.map(cell =>
    cell.row === 0 && cell.column === 0 ? { ...cell, formula: "=11", formulaDirty: true } : cell) })) };
  expect(recalculateWorkbook(changed, { ...context, runtimeFunctions: functions }).sheets[0]!.cells[2]!.value)
    .toEqual({ kind: "number", value: 18 });
});

it("rejects foreign reference sheets even when their public identifiers match", () => {
  const foreign = book("=1").sheets[0]!;
  const functions = { HOST_REFERENCE: { signature: "", implementation() { return {
    kind: "range", sheets: [foreign], firstRow: 0, lastRow: 1, firstColumn: 0, lastColumn: 0
  }; } } } as unknown as RuntimeFunctions;
  expect(() => recalculateWorkbook(book("=SUM(HOST_REFERENCE())"), { ...context, runtimeFunctions: functions }))
    .toThrow("Foreign ssconvert runtime reference sheet");
});
it("admits result area before copying arrays or walking reference members", () => {
  const functions = { HOST_ARRAY: { signature: "", implementation() { return {
    kind: "matrix", rows: [[{ kind: "blank" }, { kind: "blank" }], [{ kind: "blank" }, { kind: "blank" }]]
  }; } } } as unknown as RuntimeFunctions;
  expect(() => recalculateWorkbook(book("=HOST_ARRAY()"), { ...context, limits: { ...context.limits, cells: 3 }, runtimeFunctions: functions }))
    .toThrow("runtime matrix cell limit exceeded");
  const ranges = { HOST_REFERENCE: { signature: "", implementation(_args: unknown, host: { indirect(text: string, a1: boolean): unknown }) {
    return host.indirect("A1:A4", true);
  } } } as unknown as RuntimeFunctions;
  expect(() => recalculateWorkbook(book("=SUM(HOST_REFERENCE())"), { ...context, limits: { ...context.limits, cells: 3 }, runtimeFunctions: ranges }))
    .toThrow("runtime reference cell limit exceeded");
});
it("refuses ragged,empty and sparse matrix results without publishing them", () => {
  for (const rows of [[], [[]], [[{ kind: "blank" }], []], [new Array(2)], new Array(2)]) {
    const functions = { HOST_ARRAY: { signature: "", implementation() { return { kind: "matrix", rows }; } } } as unknown as RuntimeFunctions;
    expect(() => recalculateWorkbook(book("=HOST_ARRAY()"), { ...context, runtimeFunctions: functions })).toThrow();
  }
});
it("does not execute accessor matrix members while owning returned data", () => {
  let reads = 0;
  const row = [{ kind: "blank" }];
  Object.defineProperty(row, "0", { get() { reads++; return { kind: "number", value: 7 }; } });
  const functions = { HOST_ARRAY: { signature: "", implementation() { return { kind: "matrix", rows: [row] }; } } } as unknown as RuntimeFunctions;
  expect(() => recalculateWorkbook(book("=HOST_ARRAY()"), { ...context, runtimeFunctions: functions })).toThrow("Invalid ssconvert runtime matrix");
  expect(reads).toBe(0);
});
it("preserves cancellation after a port returns a non-scalar result", () => {
  const controller = new AbortController(), reason = new Error("stop returned matrix");
  const functions = { HOST_ARRAY: { signature: "", implementation() {
    controller.abort(reason); return { kind: "matrix", rows: [[{ kind: "blank" }]] };
  } } } as unknown as RuntimeFunctions;
  expect(() => recalculateWorkbook(book("=HOST_ARRAY()"), { ...context, signal: controller.signal, runtimeFunctions: functions })).toThrow(reason);
});

it("copies array data without calling provider-owned collection methods", () => {
  let reads = 0;
  const rows = [[{ kind: "number", value: 2 }]];
  Object.defineProperty(rows, "map", { get() { reads++; throw new Error("Borrowed collection method"); } });
  const functions = { HOST_ARRAY: { signature: "", implementation() { return { kind: "matrix", rows }; } } } as unknown as RuntimeFunctions;
  expect(recalculateWorkbook(book("=SUM(HOST_ARRAY())"), { ...context, runtimeFunctions: functions }).sheets[0]!.cells[2]!.value)
    .toEqual({ kind: "number", value: 2 });
  expect(reads).toBe(0);
});
