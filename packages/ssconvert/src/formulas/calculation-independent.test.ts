import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { SsconvertError } from "../contracts.js";
import type { FormulaResult } from "../formulas.js";
import type { Cell, CellValue, Workbook } from "../workbook.js";
import { recalculateWorkbook } from "./evaluator.js";

const context: CapabilityContext = {
  signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 100000 },
  own() {}
};
const n = (value: number): CellValue => ({ kind: "number", value });
const book = (cells: readonly Cell[]): Workbook => ({ sheets: [{ id: "s", name: "Sheet1", cells }] });
function calculate(formula: string): CellValue {
  return recalculateWorkbook(book([{ row: 0, column: 0, formula, value: n(0), formulaDirty: true }]), context).sheets[0]!.cells[0]!.value;
}

it.each([
  ['="invalid"+(1/0)', { kind: "error", value: "#VALUE!" }],
  ['=(1/0)+"invalid"', { kind: "error", value: "#DIV/0!" }],
  ['=IF("unrecognized",1/0,7)', n(7)],
  ['=IF(TRUE)', { kind: "boolean", value: true }],
  ['=IF(,1/0,8)', n(8)],
  // parser.y:468 applies format_match_simple to quoted array constants.
  ['=SUM(TRUE,"2",{3,"4";5,FALSE})', n(12)],
  ['=PRODUCT(TRUE,"2")', n(0)],
  ['=1e308*10', { kind: "error", value: "#NUM!" }],
  ['=(-1)^0.5', { kind: "error", value: "#NUM!" }],
  ['=TABLE(,)', { kind: "error", value: "#REF!" }]
] as const)("independently checks scalar semantics for %s", (formula, expected) => {
  expect(calculate(formula)).toEqual(expected);
});

it.each(['="Straße"="STRASSE"', '="ς"="Σ"'])("uses Unicode case folding in comparison %s", formula => {
  expect(calculate(formula)).toEqual({ kind: "boolean", value: true });
});

it("recomputes clean TABLE output dependencies for each temporary input substitution", () => {
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula: "=D1+E1", value: n(30), cachedResult: n(30), formulaDirty: false },
    { row: 0, column: 1, value: n(2) }, { row: 1, column: 0, value: n(3) },
    { row: 1, column: 1, value: n(0), formulaGroup: "table", formulaDirty: true },
    { row: 0, column: 3, value: n(10) }, { row: 0, column: 4, value: n(20) }
  ], formulaGroups: [{ id: "table", kind: "array", expression: "=TABLE(D1,E1)", range: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 } }] }] };
  const output = recalculateWorkbook(input, context);
  expect(output.sheets[0]!.cells.find(cell => cell.row === 1 && cell.column === 1)!.value).toEqual(n(5));
  expect(output.sheets[0]!.cells.find(cell => cell.row === 0 && cell.column === 3)!.value).toEqual(n(10));
  expect(input.sheets[0]!.cells[0]!.cachedResult).toEqual(n(30));
});

it("admits sparse TABLE input references as temporary blank cells", () => {
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula: "=D1+E1", value: n(0), formulaDirty: true },
    { row: 0, column: 1, value: n(2) }, { row: 1, column: 0, value: n(3) },
    { row: 1, column: 1, value: n(0), formulaGroup: "table", formulaDirty: true }
  ], formulaGroups: [{ id: "table", kind: "array", expression: "=TABLE(D1,E1)", range: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 } }] }] };
  const output = recalculateWorkbook(input, context);
  expect(output.sheets[0]!.cells.find(cell => cell.row === 1 && cell.column === 1)!.value).toEqual(n(5));
});

it("bounds acyclic named-expression graph traversal even for clean cached formulas", () => {
  const input: Workbook = { ...book([{ row: 0, column: 0, formula: "=name_0", value: n(7), cachedResult: n(7), formulaDirty: false }]),
    names: Array.from({ length: 140 }, (_, index) => ({ name: `name_${index}`, expression: index === 139 ? "=7" : `=name_${index + 1}` })) };
  expect(() => recalculateWorkbook(input, context)).toThrow("ssconvert formula dependency depth limit exceeded");
});

it("preserves the workbook-work refusal diagnostic", () => {
  expect(() => recalculateWorkbook(book([{ row: 0, column: 0, formula: "=1+2", formulaDirty: true, value: n(0) }]),
    { ...context, limits: { ...context.limits, workbookWork: 1 } })).toThrow("ssconvert workbook work limit exceeded");
});

it("stops injected volatility immediately on cancellation", () => {
  const controller = new AbortController(); let draws = 0;
  const input = book([{ row: 0, column: 0, formula: "=RAND()+RAND()", value: n(0), formulaDirty: true }]);
  expect(() => recalculateWorkbook(input, { ...context, signal: controller.signal, random: { next() { draws++; controller.abort(); return .5; } } })).toThrow();
  expect(draws).toBe(1);
  expect(input.sheets[0]!.cells[0]!.value).toEqual(n(0));
});

it("propagates named volatility through clean caches and dependent formulas", () => {
  let draws = 0;
  const input: Workbook = { ...book([
    { row: 0, column: 1, formula: "=A1*2", value: n(8), cachedResult: n(8), formulaDirty: false },
    { row: 0, column: 0, formula: "=draw", value: n(4), cachedResult: n(4), formulaDirty: false }
  ]), names: [{ name: "draw", expression: "=RAND()" }] };
  expect(recalculateWorkbook(input, { ...context, random: { next() { draws++; return .125; } } }).sheets[0]!.cells.map(cell => cell.value)).toEqual([n(.25), n(.125)]);
  expect(draws).toBe(1);
});

it("uses bounded dependency depth for long cell chains without altering imported cache", () => {
  const input = book(Array.from({ length: 140 }, (_, row) => ({ row, column: 0, formula: row === 139 ? "=1" : `=A${row + 2}`, formulaDirty: true, value: n(9) })));
  expect(() => recalculateWorkbook(input, context)).toThrow("ssconvert formula dependency depth limit exceeded");
  expect(input.sheets[0]!.cells[0]!.value).toEqual(n(9));
});

it("requires explicit volatility capabilities and never performs external reference I/O", () => {
  expect(() => calculate("=RAND()")).toThrow("ssconvert RAND requires an explicit random source");
  expect(() => calculate("=NOW()")).toThrow("ssconvert time functions require an explicit clock");
  expect(calculate("='[unapproved.xls]Sheet1'!A1")).toEqual({ kind: "error", value: "#REF!" });
});

it("injects UTC time reproducibly for both supported date systems", () => {
  const input = book([{ row: 0, column: 0, formula: "=TODAY()+NOW()-TODAY()", formulaDirty: true, value: n(0) }]);
  const timed = { ...context, clock: { now() { return 43200000; } } };
  expect(recalculateWorkbook(input, timed).sheets[0]!.cells[0]!.value).toEqual(n(25569.5));
  expect(recalculateWorkbook({ ...input, dateSystem: "1904" }, timed).sheets[0]!.cells[0]!.value).toEqual(n(24107.5));
});

it("recalculates cached TABLE groups when a volatile header changes", () => {
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula: "=D1+E1", value: n(30), cachedResult: n(30), formulaDirty: false },
    { row: 0, column: 1, formula: "=RAND()", value: n(2), cachedResult: n(2), formulaDirty: false },
    { row: 1, column: 0, value: n(3) },
    { row: 0, column: 3, value: n(10) }, { row: 0, column: 4, value: n(20) },
    { row: 1, column: 1, formula: "=TABLE(D1,E1)", formulaGroup: "table", value: n(5), cachedResult: n(5), formulaDirty: false }
  ], formulaGroups: [{ id: "table", kind: "array", expression: "=TABLE(D1,E1)", range: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 } }] }] };
  expect(recalculateWorkbook(input, { ...context, random: { next() { return .5; } } }).sheets[0]!.cells.at(-1)!.value).toEqual(n(3.5));
});

it("projects one volatile array calculation into every clean cached group member", () => {
  let draws = 0;
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula: "=RAND()*{1,2}", formulaGroup: "array", value: n(4), cachedResult: n(4), formulaDirty: false },
    { row: 0, column: 1, formulaGroup: "array", value: n(8), cachedResult: n(8), formulaDirty: false }
  ], formulaGroups: [{ id: "array", kind: "array", expression: "=RAND()*{1,2}", range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 } }] }] };
  expect(recalculateWorkbook(input, { ...context, random: { next() { draws++; return .25; } } }).sheets[0]!.cells.map(cell => cell.value)).toEqual([n(.25), n(.5)]);
  expect(draws).toBe(1);
});

it("resolves external references only through the explicit authorized capability", () => {
  let requests = 0;
  const input = book([{ row: 0, column: 0, formula: "='[authorized.xls]Sheet1'!A1+3", formulaDirty: true, value: n(0) }]);
  expect(recalculateWorkbook(input, { ...context, externalReferences: { resolve(request, signal) {
    requests++; expect(request.kind).toBe("reference"); expect(signal).toBe(context.signal); expect(Object.isFrozen(request)).toBe(true); return n(7);
  } } }).sheets[0]!.cells[0]!.value).toEqual(n(10));
  expect(requests).toBe(1);
});

it("rejects resolver accessors and cancellation before consuming external data", () => {
  let reads = 0;
  const input = book([{ row: 0, column: 0, formula: "='[authorized.xls]Sheet1'!A1", formulaDirty: true, value: n(0) }]);
  expect(() => recalculateWorkbook(input, { ...context, externalReferences: { resolve() {
    return { kind: "number", get value() { reads++; return 7; } };
  } } })).toThrow("accessor");
  expect(reads).toBe(0);
  const controller = new AbortController();
  expect(() => recalculateWorkbook(input, { ...context, signal: controller.signal, externalReferences: { resolve() { controller.abort(); return n(7); } } })).toThrow();
});

it.each(["=IF()", "=IF(1,2,3,4)", "=GNUMERIC_VERSION(1)", "=RAND(1)", "=NOW(1)"])("returns the registered arity error for %s", formula => {
  expect(calculate(formula)).toEqual({ kind: "error", value: "#N/A" });
});

it.each([
  ["=7", [7, 7, 7, 7]],
  ["={2;3}", [2, 2, 3, 3]],
  ["=IF({TRUE,FALSE},2,3)", [2, 3, 2, 3]]
] as const)("broadcasts array-group singleton dimensions for %s", (expression, expected) => {
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [], formulaGroups: [{ id: "array", kind: "array", expression,
    range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 } }] }] };
  expect(recalculateWorkbook(input, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual(expected.map(n));
});

it("uses boolean-only scalar text admission in the generic array-context IF path", () => {
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [], formulaGroups: [{ id: "array", kind: "array",
    expression: '=IF(IF(TRUE,"2","x"),2,3)', range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 } }] }] };
  expect(recalculateWorkbook(input, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual(Array.from({ length: 4 }, () => ({ kind: "error", value: "#VALUE!" })));
});

it.each([256, 257])("admits external array width %i independently of default sheet dimensions", width => {
  const input = book([{ row: 0, column: 0, formula: "=SUM('[authorized.xls]Sheet1'!A1)", formulaDirty: true, value: n(0) }]);
  const values = Array.from({ length: width }, (_, index) => n(index));
  const output = recalculateWorkbook(input, { ...context, externalReferences: { resolve() { return { kind: "array", rows: [values] }; } } });
  expect(output.sheets[0]!.cells[0]!.value).toEqual(n(width * (width - 1) / 2));
  values[0] = n(-999);
  expect(output.sheets[0]!.cells[0]!.value).toEqual(n(width * (width - 1) / 2));
});

it.each([null, { kind: "array", rows: [] }, { kind: "array", rows: [[]] }, { kind: "array", rows: [[n(1)], [n(2), n(3)]] }])("rejects invalid external result data with a typed diagnostic: %j", value => {
  const input = book([{ row: 0, column: 0, formula: "='[authorized.xls]Sheet1'!A1", formulaDirty: true, value: n(0) }]);
  expect(() => recalculateWorkbook(input, { ...context, externalReferences: { resolve() { return value as FormulaResult; } } })).toThrow(SsconvertError);
});

it("returns #REF for unresolved explicitly authorized external requests", () => {
  const input = book([{ row: 0, column: 0, formula: "='[authorized.xls]Sheet1'!A1", formulaDirty: true, value: n(0) }]);
  expect(recalculateWorkbook(input, { ...context, externalReferences: { resolve() { return undefined; } } }).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#REF!" });
});

it.each([[1, 2], [0, 2]] as const)("counts recursive dirty-flag self-iteration passes at tolerance %s", (tolerance, expectedDraws) => {
  let draws = 0;
  const input: Workbook = { ...book([{ row: 0, column: 0, formula: "=A1+RAND()*0", formulaDirty: true, value: n(7) }]),
    iteration: { enabled: true, maximum: 4, tolerance } };
  expect(recalculateWorkbook(input, { ...context, random: { next() { draws++; return .5; } } }).sheets[0]!.cells[0]!.value).toEqual(n(7));
  expect(draws).toBe(expectedDraws);
});

it.each([[1, 2], [0, 2]] as const)("uses exact string value differences with strict tolerance %s", (tolerance, expectedDraws) => {
  let draws = 0;
  const input: Workbook = { ...book([{ row: 0, column: 0, formula: '=IF(A1="same",IF(RAND()<1,"same","other"),"same")', formulaDirty: true, value: { kind: "string", value: "same" } }]),
    iteration: { enabled: true, maximum: 4, tolerance } };
  expect(recalculateWorkbook(input, { ...context, random: { next() { draws++; return .5; } } }).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "same" });
  expect(draws).toBe(expectedDraws);
});

it.each([['=IF("invalid",RAND(),7)', "#VALUE!"], ["=IF(1/0,RAND(),7)", "#DIV/0!"]] as const)("validates scalar IF conditions before generic array branch evaluation: %s", (expression, expected) => {
  let draws = 0;
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [], formulaGroups: [{ id: "array", kind: "array", expression,
    range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } }] }] };
  expect(recalculateWorkbook(input, { ...context, random: { next() { draws++; return .5; } } }, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: expected });
  expect(draws).toBe(0);
});
