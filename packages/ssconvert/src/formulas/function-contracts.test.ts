import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
import type { CellValue, Workbook } from "../workbook.js";
import { dirtyWorkbook } from "../workbook/updates/recalculation.js";
import { parseExpression } from "./parser.js";
import { gnumericGrammar, legacyOpenOfficeGrammar, odfGrammar } from "./conventions.js";
import { serializeExpression } from "./serialization.js";

const context: CapabilityContext = { signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 3, operations: 100, workbookWork: 10000 }, own() {} };
const n = (value: number): CellValue => ({ kind: "number", value });
const e = (value: string): CellValue => ({ kind: "error", value });
it.each([
  ['=VALUE("tRuE")', { kind: "boolean", value: true }],
  ['=VALUE(" TRUE")', e("#VALUE!")],
  ['=VALUE("TRUE ")', e("#VALUE!")],
  ['=NUMBERVALUE(" FALSE",".")', { kind: "boolean", value: false }],
  ['=N("TRUE")', { kind: "boolean", value: true }],
  ['=LEFT("abc","TRUE")', { kind: "string", value: "a" }]
] as [string, CellValue][])("preserves released boolean number matching for %s", (formula, expected) => {
  expect(evaluate(formula)).toEqual(expected);
});
it("number-matches string conditions from ranges in array IF", () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 3, value: { kind: "string", value: "1" } },
    { row: 1, column: 3, value: { kind: "string", value: "0" } },
    { row: 2, column: 3, value: { kind: "string", value: "TRUE" } },
    { row: 3, column: 3, value: { kind: "string", value: "FALSE" } },
    { row: 4, column: 3, value: { kind: "string", value: "invalid" } }
  ], formulaGroups: [{ id: "a", kind: "array", expression: '=IF(D1:D5,7,8)',
    range: { startRow: 0, endRow: 4, startColumn: 0, endColumn: 0 } }] }] };
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.filter(cell => cell.column === 0).map(cell => cell.value)).toEqual([n(7), n(8), n(7), n(8), e("#VALUE!")]);
});
function evaluate(formula: string, supplied: CapabilityContext = context): CellValue {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [{ row: 0, column: 0, value: n(0), formula, formulaDirty: true }] }] };
  return recalculateWorkbook(book, supplied).sheets[0]!.cells[0]!.value;
}
it("matches formatted number strings when coercing numeric descriptors", () => {
  expect(evaluate('=CHAR("$65")')).toEqual({ kind: "string", value: "A" });
  expect(evaluate('=LEFT("abc","100%")')).toEqual({ kind: "string", value: "a" });
  expect(evaluate('=NOT("1")')).toEqual(e("#VALUE!"));
});
it("reads operating identity only from the explicitly injected environment", () => {
  const supplied = { ...context, environment: { ...context.environment, system: "ReferenceOS", osVersion: "ReferenceOS version 6" } };
  expect(evaluate('=INFO("system")', supplied)).toEqual({ kind: "string", value: "ReferenceOS" });
  expect(evaluate('=INFO("osversion")', supplied)).toEqual({ kind: "string", value: "ReferenceOS version 6" });
  expect(() => evaluate('=INFO("system")')).toThrow("captured environment identity");
});
it("rejects extra fixed arguments before evaluating host expressions", () => {
  let calls = 0;
  const supplied = { ...context, random: { next() { calls++; return .5; } } };
  expect(evaluate('=LEN("a",RAND())', supplied)).toEqual(e("#N/A"));
  expect(calls).toBe(0);
});
it("precomputes array arguments while preserving element errors and dimensions", () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [], formulaGroups: [
    { id: "a", kind: "array", expression: '=IFERROR(LEN({"a","abc"}),9)', range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 } }
  ] }] };
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual([n(1), n(3)]);
});
it.each(['=SUM(INDIRECT("A1:C1"))', '=SUM(OFFSET(A1,0,0,1,3))', '=SUM(INDEX(A1:C1,1,1):C1)', '=SUM(CHOOSE(1,A1:A1,A2:A2):C1)'])("invalidates cached computed range interiors for %s", formula => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 1, column: 3, formula, formulaDirty: false, value: n(4), cachedResult: n(4) },
    { row: 0, column: 0, value: n(1) }, { row: 0, column: 1, value: n(8) }, { row: 0, column: 2, value: n(3) }
  ] }] };
  const dirty = dirtyWorkbook(book, [{ sheet: "s", startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 }], context);
  expect(dirty.sheets[0]!.cells[0]!.formulaDirty).toBe(true);
  expect(recalculateWorkbook(dirty, context).sheets[0]!.cells[0]!.cachedResult).toEqual(n(12));
  expect(book.sheets[0]!.cells[0]!.cachedResult).toEqual(n(4));
});
it.each([["INDIRECT_XL", "INDIRECT"], ["ADDRESS_XL", "ADDRESS"], ["ERRORTYPE", "ERROR.TYPE"], ["FORMULA", "GET.FORMULA"], ["USDOLLAR", "DOLLAR"]])("imports OpenFormula alias %s", (alias, name) => {
  const parsed = parseExpression(`of:=${alias}(1)`, { grammar: odfGrammar, position: { sheet: "s", row: 0, column: 0 } });
  expect(parsed.ok && parsed.document.root.kind === "call" && parsed.document.root.name).toBe(name);
});
it.each([["CONCAT", "COM.MICROSOFT.CONCAT"], ["CONCATENATE", "COM.MICROSOFT.CONCAT"], ["GET.FORMULA", "FORMULA"], ["EXPRESSION", "ORG.GNUMERIC.EXPRESSION"], ["IF", "IF"]])("exports OpenFormula spelling for %s", (name, alias) => {
  const parsed = parseExpression(`=${name}(1)`, { position: { sheet: "s", row: 0, column: 0 } });
  if (!parsed.ok) throw new Error("Original fixture failed to parse");
  expect(serializeExpression(parsed.document, odfGrammar, false)).toBe(`of:=${alias}(1)`);
});
it("persists dynamic links and replaces obsolete links without discarding declared dependencies", () => {
  const range = (column: number) => ({ sheet: "s", startRow: 0, endRow: 0, startColumn: column, endColumn: column });
  const dependent = { ...range(4), startRow: 1, endRow: 1 };
  const book: Workbook = { dependencies: [{ dependent, precedent: range(5) }], sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 1, column: 4, formula: '=INDIRECT(LEFT(D1,2))', formulaDirty: true, value: n(0) },
    { row: 0, column: 0, value: n(1) }, { row: 0, column: 1, value: n(8) },
    { row: 0, column: 3, value: { kind: "string", value: "A1suffix" } }
  ] }] };
  const first = recalculateWorkbook(book, context);
  expect(dirtyWorkbook(first, [range(0)], context).sheets[0]!.cells[0]!.formulaDirty).toBe(true);
  const changed = { ...first, sheets: first.sheets.map(sheet => ({ ...sheet, cells: sheet.cells.map(cell => cell.column === 3 ? { ...cell, value: { kind: "string" as const, value: "B1suffix" } } : cell) })) };
  const second = recalculateWorkbook(dirtyWorkbook(changed, [range(3)], context), context);
  expect(second.sheets[0]!.cells[0]!.cachedResult).toEqual(n(8));
  expect(dirtyWorkbook(second, [range(0)], context).sheets[0]!.cells[0]!.formulaDirty).toBe(false);
  expect(dirtyWorkbook(second, [range(1)], context).sheets[0]!.cells[0]!.formulaDirty).toBe(true);
  expect(second.dependencies).toContainEqual({ dependent, precedent: range(5) });
  expect(recalculateWorkbook(second, context)).toEqual(second);
});
it.each([["EXPRESSION", 'SUM(1,2)+3*4'], ["GET.FORMULA", '=SUM(1,2)+3*4']])("canonicalizes parsed formula metadata for %s", (name, expected) => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, formula: '= sum ( 1 , 2 ) + 3 * 4', formulaDirty: false, value: n(15) },
    { row: 1, column: 1, formula: `=${name}(A1)`, formulaDirty: true, value: n(0) }
  ] }] };
  expect(recalculateWorkbook(book, context).sheets[0]!.cells[1]!.value).toEqual({ kind: "string", value: expected });
  expect(book.sheets[0]!.cells[0]!.formula).toBe('= sum ( 1 , 2 ) + 3 * 4');
});
it("uses OpenFormula boolean function literals", () => {
  const parsed = parseExpression('=IF(TRUE,"a","b")', { position: { sheet: "s", row: 0, column: 0 } });
  if (!parsed.ok) throw new Error("Original fixture failed to parse");
  expect(serializeExpression(parsed.document, odfGrammar, false)).toBe('of:=IF(TRUE();"a";"b")');
});
it("distinguishes direct cell values from singleton range constants for TYPE", () => {
  expect(evaluate('=TYPE(A1)')).toEqual(n(1));
  expect(evaluate('=TYPE(A1:A1)')).toEqual(n(16));
});
it("materializes missing-field database count cells before testing their criteria", () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 3, column: 4, formula: '=DCOUNT(A1:B2,,D1:D2)', formulaDirty: true, value: n(9) },
    { row: 0, column: 0, value: { kind: "string", value: "Kind" } }, { row: 0, column: 1, value: { kind: "string", value: "Value" } },
    { row: 1, column: 1, value: n(7) }, { row: 0, column: 3, value: { kind: "string", value: "Kind" } },
    { row: 1, column: 3, value: { kind: "string", value: "a" } }
  ] }] };
  const calculated = recalculateWorkbook(book, context);
  expect(calculated.sheets[0]!.cells[0]!.cachedResult).toEqual(n(0));
  expect(calculated.sheets[0]!.cells.at(-1)).toEqual({ row: 1, column: 0, value: { kind: "blank" } });
  expect(book.sheets[0]!.cells).toHaveLength(6);
  expect(recalculateWorkbook(calculated, context)).toEqual(calculated);
});
it.each(['=SUM(INDIRECT("(A1:C1)"))', '=SUM(INDIRECT("target"))'])("extracts parenthesized and named INDIRECT ranges for %s", formula => {
  const book: Workbook = { names: [{ name: "target", expression: "=A1:C1", position: { sheet: "s", row: 0, column: 0 } }], sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 2, column: 4, formula, formulaDirty: true, value: n(9) },
    { row: 0, column: 0, value: n(1) }, { row: 0, column: 1, value: n(8) }, { row: 0, column: 2, value: n(3) }
  ] }] };
  expect(recalculateWorkbook(book, context).sheets[0]!.cells[0]!.cachedResult).toEqual(n(12));
});
it.each<[string, CellValue[]]>([
  ['=INFO({1,"release"})', [e("#VALUE!"), { kind: "string", value: "1.12.61" }]],
  ['=NOT({"1","0"})', [{ kind: "boolean", value: false }, { kind: "boolean", value: true }]]
])("uses the released per-element coercion for %s", (formula, expected) => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [], formulaGroups: [
    { id: "a", kind: "array", expression: formula, range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 } }
  ] }] };
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual(expected);
});
it("inserts the missing A1 argument only for legacy OpenOffice ADDRESS", () => {
  for (const [grammar, expected] of [[legacyOpenOfficeGrammar, '=ADDRESS(1,2,1,1,"Sheet")'], [odfGrammar, '=ADDRESS(1,2,1,"Sheet")']] as const) {
    const separator = grammar.arguments;
    const parsed = parseExpression(`=ADDRESS(1${separator}2${separator}1${separator}"Sheet")`, { grammar, position: { sheet: "s", row: 0, column: 0 } });
    if (!parsed.ok) throw new Error("Original ADDRESS fixture failed to parse");
    expect(serializeExpression(parsed.document, gnumericGrammar, false)).toBe(expected);
  }
});
it.each(["DAVERAGE", "DVAR", "DVARP", "DSTDEV", "DSTDEVP"])("preserves the GOffice constant-range shortcut for %s", name => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 4, column: 4, formula: `=${name}(A1:A3,1,C1:C2)`, formulaDirty: true, value: n(9) },
    { row: 0, column: 0, value: { kind: "string", value: "Value" } }, { row: 1, column: 0, value: n(1e308) }, { row: 2, column: 0, value: n(1e308) },
    { row: 0, column: 2, value: { kind: "string", value: "Value" } }, { row: 1, column: 2, value: { kind: "blank" } }
  ] }] };
  expect(recalculateWorkbook(book, context).sheets[0]!.cells[0]!.cachedResult).toEqual(n(name === "DAVERAGE" ? 1e308 : 0));
});
it.each(['=TYPE(IF(TRUE,A1,B1))', '=TYPE(CHOOSE(1,A1,B1))'])("propagates direct-cell value mode through %s", formula => {
  expect(evaluate(formula)).toEqual(n(1));
});
it("treats direct cells as scalar IF array arguments", () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, value: n(1) }, { row: 1, column: 0, value: n(2) }, { row: 0, column: 1, value: n(9) }
  ], formulaGroups: [{ id: "a", kind: "array", expression: '=IF({TRUE;FALSE},A1:A2,B1)', range: { startRow: 0, endRow: 1, startColumn: 4, endColumn: 4 } }] }] };
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.filter(cell => cell.column === 4).map(cell => cell.value)).toEqual([n(1), n(9)]);
});
