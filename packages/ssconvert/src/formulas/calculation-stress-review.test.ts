import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { recalculateWorkbook } from "./evaluator.js";
import { setCellText } from "../workbook/updates/index.js";

const context: CapabilityContext = {
  signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 100000 },
  own() {}
};

it("refuses combined named-expression and syntax dependency depth with a typed limit", () => {
  const input: Workbook = {
    sheets: [{ id: "s", name: "Sheet1", cells: [{ row: 0, column: 0, formula: "=name_0", value: { kind: "number", value: 7 }, cachedResult: { kind: "number", value: 7 }, formulaDirty: false }] }],
    names: Array.from({ length: 110 }, (_, index) => ({ name: `name_${index}`, expression: "=" + "(".repeat(80) + (index === 109 ? "7" : `name_${index + 1}`) + ")".repeat(80) }))
  };
  expect(() => recalculateWorkbook(input, context)).toThrow("ssconvert formula dependency depth limit exceeded");
  expect(input.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 7 });
});

it("terminates cyclic names without acquiring external authority in an unselected branch", () => {
  let resolutions = 0;
  const input: Workbook = {
    sheets: [{ id: "s", name: "Sheet1", cells: [{ row: 0, column: 0, formula: "=IF(TRUE,first,'[forbidden.xls]Sheet1'!A1)", value: { kind: "number", value: 7 }, formulaDirty: true }] }],
    names: [{ name: "first", expression: "=second" }, { name: "second", expression: "=first" }]
  };
  const output = recalculateWorkbook(input, { ...context, externalReferences: { resolve() { resolutions++; throw new Error("unexpected authority"); } } });
  expect(output.sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#NAME?" });
  expect(resolutions).toBe(0);
});

it("propagates a recalculated named precedent through clean cached errors", () => {
  const input: Workbook = {
    sheets: [{ id: "s", name: "Sheet1", cells: [
      { row: 0, column: 1, formula: "=source+1", value: { kind: "error", value: "#DIV/0!" }, cachedResult: { kind: "error", value: "#DIV/0!" }, formulaDirty: false },
      { row: 0, column: 0, formula: "=9", value: { kind: "error", value: "#DIV/0!" }, formulaDirty: true }
    ] }], names: [{ name: "source", expression: "=Sheet1!$A$1" }]
  };
  expect(recalculateWorkbook(input, context).sheets[0]!.cells.map(cell => cell.value)).toEqual([{ kind: "number", value: 10 }, { kind: "number", value: 9 }]);
  expect(input.sheets[0]!.cells[0]!.cachedResult).toEqual({ kind: "error", value: "#DIV/0!" });
});

it("recalculates shared relative links independently of sparse input cell order", () => {
  const input: Workbook = {
    sheets: [{ id: "s", name: "Sheet1", cells: [
      { row: 1, column: 1, formulaGroup: "shared", formula: "=A2+1", value: { kind: "number", value: 99 }, cachedResult: { kind: "number", value: 99 }, formulaDirty: false },
      { row: 0, column: 1, formulaGroup: "shared", formula: "=A1+1", value: { kind: "number", value: 99 }, cachedResult: { kind: "number", value: 99 }, formulaDirty: false },
      { row: 1, column: 0, formula: "=8", value: { kind: "number", value: 0 }, formulaDirty: true },
      { row: 0, column: 0, formula: "=3", value: { kind: "number", value: 0 }, formulaDirty: true }
    ], formulaGroups: [{ id: "shared", kind: "shared", expression: "=A1+1", range: { startRow: 0, endRow: 1, startColumn: 1, endColumn: 1 } }] }]
  };
  expect(recalculateWorkbook(input, context).sheets[0]!.cells.map(cell => cell.value)).toEqual([9, 4, 8, 3].map(value => ({ kind: "number", value })));
});

it.each(["=SUM((A1):(C1))", "=SUM(left_edge:right_edge)", "=SUM((left_edge):(right_edge))", "=SUM(((A1):(B1)):(C1))", "=SUM(((A1:C1) (A1:B1)):(C1))", "=SUM(IF(TRUE,A1,A2):C1)"])("invalidates cached computed-range interiors for %s", formula => {
  const input: Workbook = {
    sheets: [{ id: "s", name: "Sheet1", cells: [
      { row: 1, column: 0, formula, value: { kind: "number", value: 6 }, cachedResult: { kind: "number", value: 6 }, formulaDirty: false },
      { row: 0, column: 0, value: { kind: "number", value: 1 } },
      { row: 0, column: 1, formula: "=8", value: { kind: "number", value: 2 }, formulaDirty: true },
      { row: 0, column: 2, value: { kind: "number", value: 3 } }
    ] }], names: [{ name: "left_edge", expression: "=Sheet1!$A$1" }, { name: "right_edge", expression: "=Sheet1!$C$1" }]
  };
  expect(recalculateWorkbook(input, context).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 12 });
});

it.each(["=0/-3", "=PRODUCT(-1,0)", "=SUM(-0)", "=-(-0)"])("canonicalizes calculated signed zero for %s", formula => {
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [{ row: 0, column: 0, formula, value: { kind: "number", value: 9 }, formulaDirty: true }] }] };
  expect(recalculateWorkbook(input, context).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 0 });
});

it("skips missing TABLE columns without acquiring cached external output authority", () => {
  let resolutions = 0;
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula: "='[authorized.xls]Sheet1'!A1", value: { kind: "number", value: 30 }, cachedResult: { kind: "number", value: 30 }, formulaDirty: false },
    { row: 1, column: 0, value: { kind: "number", value: 3 } },
    { row: 1, column: 1, formulaGroup: "table", value: { kind: "number", value: 99 }, formulaDirty: true }
  ], formulaGroups: [{ id: "table", kind: "array", expression: "=TABLE(D1,E1)", range: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 } }] }] };
  const output = recalculateWorkbook(input, { ...context, externalReferences: { resolve() { resolutions++; throw new Error("unexpected authority"); } } });
  expect(output.sheets[0]!.cells.find(cell => cell.row === 1 && cell.column === 1)!.value).toEqual({ kind: "number", value: 0 });
  expect(resolutions).toBe(0);
  expect(output.sheets[0]!.cells.some(cell => cell.column > 1)).toBe(false);
  expect(input.sheets[0]!.cells[0]!.cachedResult).toEqual({ kind: "number", value: 30 });
});

it("rolls TABLE substitutions back after resolver cancellation and admits a fresh run", () => {
  const controller = new AbortController();
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula: "='[authorized.xls]Sheet1'!A1+D1+E1", value: { kind: "number", value: 30 }, cachedResult: { kind: "number", value: 30 }, formulaDirty: false },
    { row: 0, column: 1, value: { kind: "number", value: 2 } },
    { row: 1, column: 0, value: { kind: "number", value: 3 } },
    { row: 1, column: 1, formulaGroup: "table", value: { kind: "number", value: 99 }, formulaDirty: true },
    { row: 0, column: 3, value: { kind: "number", value: 10 } }, { row: 0, column: 4, value: { kind: "number", value: 20 } }
  ], formulaGroups: [{ id: "table", kind: "array", expression: "=TABLE(D1,E1)", range: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 } }] }] };
  expect(() => recalculateWorkbook(input, { ...context, signal: controller.signal, externalReferences: { resolve() { controller.abort(); return { kind: "number", value: 7 }; } } })).toThrow();
  const output = recalculateWorkbook(input, { ...context, externalReferences: { resolve() { return { kind: "number", value: 7 }; } } });
  expect(output.sheets[0]!.cells.find(cell => cell.row === 1 && cell.column === 1)!.value).toEqual({ kind: "number", value: 12 });
  expect(output.sheets[0]!.cells.find(cell => cell.column === 3)!.value).toEqual({ kind: "number", value: 10 });
  expect(output.sheets[0]!.cells.find(cell => cell.column === 4)!.value).toEqual({ kind: "number", value: 20 });
  expect(input.sheets[0]!.cells[0]!.cachedResult).toEqual({ kind: "number", value: 30 });
});

it("keeps qualified scoped-name changes separate from unrelated sheet coordinates", () => {
  const input: Workbook = { names: [
    { name: "source", expression: "=First!$A$1", position: { sheet: "first", row: 0, column: 0 } },
    { name: "source", sheet: "second", expression: "=A1", position: { sheet: "second", row: 3, column: 2 } }
  ], sheets: [
    { id: "first", name: "First", cells: [{ row: 0, column: 0, value: { kind: "number", value: 2 } },
      { row: 2, column: 2, formula: "=Second!source+1", value: { kind: "number", value: 4 }, cachedResult: { kind: "number", value: 4 }, formulaDirty: false }] },
    { id: "second", name: "Second", cells: [{ row: 0, column: 0, value: { kind: "number", value: 3 } }] }
  ] };
  const range = { sheet: "first", startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
  expect(setCellText(input, range, "8", context).sheets[0]!.cells[1]!.formulaDirty).toBe(false);
  const changed = setCellText(input, { ...range, sheet: "second" }, "8", context);
  expect(changed.sheets[0]!.cells[1]!.formulaDirty).toBe(true);
  expect(recalculateWorkbook(changed, context).sheets[0]!.cells[1]!.value).toEqual({ kind: "number", value: 9 });
});

it("invalidates sparse computed ranges and all stored array members without formulas", () => {
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, value: { kind: "number", value: 1 } }, { row: 0, column: 2, value: { kind: "number", value: 3 } },
    { row: 1, column: 0, formulaGroup: "array", value: { kind: "number", value: 4 }, cachedResult: { kind: "number", value: 4 }, formulaDirty: false },
    { row: 1, column: 1, formulaGroup: "array", value: { kind: "number", value: 8 }, cachedResult: { kind: "number", value: 8 }, formulaDirty: false }
  ], formulaGroups: [{ id: "array", kind: "array", expression: "=SUM((A1):(C1))*{1,2}", range: { startRow: 1, endRow: 1, startColumn: 0, endColumn: 1 } }] }] };
  const updated = setCellText(input, { sheet: "s", startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 }, "8", context);
  expect(updated.sheets[0]!.cells.filter(cell => cell.formulaGroup === "array").map(cell => cell.formulaDirty)).toEqual([true, true]);
  expect(recalculateWorkbook(updated, context).sheets[0]!.cells.filter(cell => cell.formulaGroup === "array").map(cell => cell.value)).toEqual([12, 24].map(value => ({ kind: "number", value })));
  expect(input.sheets[0]!.cells.some(cell => cell.row === 0 && cell.column === 1)).toBe(false);
});

it("replays ordered updates identically across a plain-data workbook checkpoint", () => {
  const original: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, value: { kind: "number", value: 1 } }, { row: 0, column: 2, value: { kind: "number", value: 3 } },
    { row: 1, column: 0, formula: "=SUM(IF(TRUE,A1,A3):C1)", value: { kind: "number", value: 4 }, cachedResult: { kind: "number", value: 4 }, formulaDirty: false }
  ] }] };
  const range = { sheet: "s", startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 };
  const first = recalculateWorkbook(setCellText(original, range, "8", context), context);
  const checkpoint = JSON.parse(JSON.stringify(first)) as Workbook;
  const resumed = recalculateWorkbook(setCellText(checkpoint, range, "11", context), context);
  const replayed = recalculateWorkbook(setCellText(recalculateWorkbook(setCellText(original, range, "8", context), context), range, "11", context), context);
  expect(resumed).toEqual(replayed);
  expect(resumed.sheets[0]!.cells.find(cell => cell.row === 1)!.value).toEqual({ kind: "number", value: 15 });
});

it("refuses canceled and under-budget cell-update graph work without changing original caches", () => {
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [{ row: 1, column: 0, formula: "=SUM((A1):(C1))", value: { kind: "number", value: 4 }, cachedResult: { kind: "number", value: 4 }, formulaDirty: false }] }] };
  const range = { sheet: "s", startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 };
  expect(() => setCellText(input, range, "8", { ...context, limits: { ...context.limits, workbookWork: 1 } })).toThrow("ssconvert workbook work limit exceeded");
  const controller = new AbortController(); controller.abort();
  expect(() => setCellText(input, range, "8", { ...context, signal: controller.signal })).toThrow();
  expect(input.sheets[0]!.cells[0]).toMatchObject({ cachedResult: { kind: "number", value: 4 }, formulaDirty: false });
  expect(input.sheets[0]!.cells).toHaveLength(1);
});

it("explicitly refuses unsupported foreign workbook and resolver record prototypes", () => {
  const input = runInNewContext('({ sheets: [{ id: "s", name: "Sheet1", cells: [{ row: 0, column: 0, formula: "=SUM(\'[authorized.xls]Sheet1\'!A1)", value: { kind: "number", value: 0 }, formulaDirty: true }] }] })') as Workbook;
  const state = { getterReads: 0, resolutions: 0 };
  const result = runInNewContext('({ kind: "array", get rows() { state.getterReads++; return [[{kind: "number", value: 3}]]; } })', { state }) as { kind: "array"; rows: { kind: "number"; value: number }[][] };
  const supplied = { ...context, externalReferences: { resolve() { state.resolutions++; return result; } } };
  expect(() => recalculateWorkbook(input, supplied)).toThrow("Unsupported workbook prototype");
  expect(state.resolutions).toBe(0);
  const local = JSON.parse(JSON.stringify(input)) as Workbook;
  expect(() => recalculateWorkbook(local, supplied)).toThrow("Unsupported workbook prototype");
  expect(state.resolutions).toBe(1);
  expect(state.getterReads).toBe(0);
  expect(input.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 0 });
  expect(local.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 0 });
});

it("preserves cross-realm host refusal identity without publishing partial results", () => {
  const reason = runInNewContext('new Error("authorized resolver refusal")') as Error;
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [{ row: 0, column: 0, formula: "='[authorized.xls]Sheet1'!A1", value: { kind: "number", value: 9 }, formulaDirty: true }] }] };
  let observed: unknown;
  try { recalculateWorkbook(input, { ...context, externalReferences: { resolve() { throw reason; } } }); } catch (error) { observed = error; }
  expect(observed).toBe(reason);
  expect(input.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 9 });
});

it("bounds named dependencies during sparse cell-update admission", () => {
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [{ row: 0, column: 0, formula: "=name_0", value: { kind: "number", value: 7 }, cachedResult: { kind: "number", value: 7 }, formulaDirty: false }] }],
    names: Array.from({ length: 140 }, (_, index) => ({ name: `name_${index}`, expression: index === 139 ? "=B1" : `=name_${index + 1}` })) };
  expect(() => setCellText(input, { sheet: "s", startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 }, "8", context)).toThrow("ssconvert formula dependency depth limit exceeded");
  expect(input.sheets[0]!.cells).toHaveLength(1);
  expect(input.sheets[0]!.cells[0]!.cachedResult).toEqual({ kind: "number", value: 7 });
});

it("applies negative-base exponent domain checks independently across array elements", () => {
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [], formulaGroups: [{ id: "array", kind: "array", expression: "={-1,-1,1}^{2147483648,2147483647,2147483648}", range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 2 } }] }] };
  expect(recalculateWorkbook(input, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual([{ kind: "error", value: "#NUM!" }, { kind: "number", value: -1 }, { kind: "number", value: 1 }]);
});

it("limits nonsingleton array power dimensions to their common width before aggregation", () => {
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [], formulaGroups: [{ id: "array", kind: "array", expression: "=SUM({2,3,4}^{1,1})", range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } }] }] };
  expect(recalculateWorkbook(input, context, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 5 });
});

it("keeps qualified sparse TABLE arguments inert through canceled output evaluation and retry", () => {
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula: "='[output.xls]Sheet1'!A1+D1+E1", value: { kind: "number", value: 30 }, cachedResult: { kind: "number", value: 30 }, formulaDirty: false },
    { row: 0, column: 1, value: { kind: "number", value: 2 } }, { row: 1, column: 0, value: { kind: "number", value: 3 } },
    { row: 1, column: 1, formulaGroup: "table", value: { kind: "number", value: 99 }, formulaDirty: true }
  ], formulaGroups: [{ id: "table", kind: "array", expression: "=TABLE('[forbidden.xls]Other'!D1,'[forbidden.xls]Other'!E1)", range: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 } }] }] };
  const controller = new AbortController();
  const observed: string[] = [];
  expect(() => recalculateWorkbook(input, { ...context, signal: controller.signal, externalReferences: { resolve(request) { observed.push(request.kind === "reference" ? request.first.workbook! : request.workbook); controller.abort(); return { kind: "number", value: 7 }; } } })).toThrow();
  expect(observed).toEqual(["output.xls"]);
  const output = recalculateWorkbook(input, { ...context, externalReferences: { resolve(request) { expect(request.kind === "reference" ? request.first.workbook : request.workbook).toBe("output.xls"); return { kind: "number", value: 7 }; } } });
  expect(output.sheets[0]!.cells.find(cell => cell.formulaGroup === "table")!.value).toEqual({ kind: "number", value: 12 });
  expect(output.sheets[0]!.cells.some(cell => cell.column > 1)).toBe(false);
  expect(input.sheets[0]!.cells).toHaveLength(4);
  expect(input.sheets[0]!.cells[0]!.cachedResult).toEqual({ kind: "number", value: 30 });
});

it.each([1, 3, 10])("uses released recursive dirty-flag clearing for self iteration cap %i", maximum => {
  const input: Workbook = { iteration: { enabled: true, maximum, tolerance: 0 }, sheets: [{ id: "s", name: "Sheet1", cells: [{ row: 0, column: 0, formula: "=A1+1", value: { kind: "number", value: 0 }, cachedResult: { kind: "number", value: 0 }, formulaDirty: true }] }] };
  expect(recalculateWorkbook(input, context).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 2 });
});

it("reads the current self value after the recursive calculation clears its dirty flag", () => {
  const input: Workbook = { iteration: { enabled: true, maximum: 100, tolerance: 1 }, sheets: [{ id: "s", name: "Sheet1", cells: [{ row: 0, column: 0, formula: "=A1/2", value: { kind: "number", value: 100 }, cachedResult: { kind: "number", value: 100 }, formulaDirty: true }] }] };
  expect(recalculateWorkbook(input, context).sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 25 });
});

it.each([false, true])("keeps completed dependencies cached while preserving multi-cell cycle storage order: %s", reverse => {
  const cells = [{ row: 0, column: 0, formula: "=B1+1", value: { kind: "number" as const, value: 0 }, cachedResult: { kind: "number" as const, value: 0 }, formulaDirty: true },
    { row: 0, column: 1, formula: "=A1+1", value: { kind: "number" as const, value: 0 }, cachedResult: { kind: "number" as const, value: 0 }, formulaDirty: true }];
  if (reverse) cells.reverse();
  const input: Workbook = { iteration: { enabled: true, maximum: 3, tolerance: 0 }, sheets: [{ id: "s", name: "Sheet1", cells }] };
  expect(recalculateWorkbook(input, context).sheets[0]!.cells.map(cell => cell.value)).toEqual([{ kind: "number", value: 2 }, { kind: "number", value: 1 }]);
  expect(input.sheets[0]!.cells.map(cell => cell.cachedResult)).toEqual([{ kind: "number", value: 0 }, { kind: "number", value: 0 }]);
});

it("cancels a TABLE self-cycle and restores flags and caches for a fresh calculation", () => {
  const input: Workbook = { iteration: { enabled: true, maximum: 3, tolerance: 0 }, sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 1, column: 1, formulaGroup: "table", value: { kind: "number", value: 99 }, formulaDirty: true },
    { row: 0, column: 0, formula: "=D1+E1+A1*0+RAND()*0", value: { kind: "number", value: 30 }, cachedResult: { kind: "number", value: 30 }, formulaDirty: false },
    { row: 0, column: 1, value: { kind: "number", value: 2 } }, { row: 1, column: 0, value: { kind: "number", value: 3 } }
  ], formulaGroups: [{ id: "table", kind: "array", expression: "=TABLE(D1,E1)", range: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 } }] }] };
  const controller = new AbortController(); let draws = 0;
  expect(() => recalculateWorkbook(input, { ...context, signal: controller.signal, random: { next() { if (++draws === 2) controller.abort(); return .5; } } })).toThrow();
  expect(draws).toBe(2);
  const output = recalculateWorkbook(input, { ...context, random: { next() { return .5; } } });
  expect(output.sheets[0]!.cells.find(cell => cell.formulaGroup === "table")!.value).toEqual({ kind: "number", value: 5 });
  expect(output.sheets[0]!.cells.some(cell => cell.column > 1)).toBe(false);
  expect(input.sheets[0]!.cells[1]!.cachedResult).toEqual({ kind: "number", value: 30 });
});

it.each([false, true])("preserves unrelated volatile TABLE row-header caches (array=%s)", arrayHeader => {
  let draws = 0;
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 1, column: 0, ...(arrayHeader ? { formulaGroup: "random" } : { formula: "=RAND()" }), value: { kind: "number", value: 0 }, formulaDirty: true },
    ...(arrayHeader ? [{ row: 2, column: 0, formulaGroup: "random", value: { kind: "number" as const, value: 0 }, formulaDirty: true }] : []),
    { row: 0, column: 0, formula: `=IF(${arrayHeader ? "A3" : "A2"}=E1,1,0)`, value: { kind: "number", value: 0 }, formulaDirty: true },
    { row: 0, column: 1, value: { kind: "number", value: 2 } },
    { row: 1, column: 1, formulaGroup: "table", value: { kind: "number", value: 0 }, formulaDirty: true },
    { row: 0, column: 3, value: { kind: "number", value: 10 } },
    { row: 0, column: 4, value: { kind: "number", value: 20 } }
  ], formulaGroups: [
    { id: "table", kind: "array", expression: "=TABLE(D1,E1)", range: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 } },
    ...(arrayHeader ? [{ id: "random", kind: "array" as const, expression: "=RAND()", range: { startRow: 1, endRow: 2, startColumn: 0, endColumn: 0 } }] : [])
  ] }] };
  const output = recalculateWorkbook(input, { ...context, random: { next() { return ++draws / 10; } } });
  expect(output.sheets[0]!.cells.find(cell => cell.row === 1 && cell.column === 1)!.value).toEqual({ kind: "number", value: 1 });
  expect(draws).toBe(1);
  expect(input.sheets[0]!.cells.find(cell => cell.column === 4)!.value).toEqual({ kind: "number", value: 20 });
});
