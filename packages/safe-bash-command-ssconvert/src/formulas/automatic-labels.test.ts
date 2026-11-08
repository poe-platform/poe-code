import { expect, it } from "vitest";
import { parseExpression } from "./parser.js";
import { serializeExpression } from "./serialization.js";
import { gnumericGrammar, odfGrammar, legacyOpenOfficeGrammar } from "./conventions.js";
import { recalculateWorkbook } from "./evaluator.js";
import { rewriteReferences } from "./rewriting.js";
import type { Cell, Workbook } from "../workbook.js";
import type { CapabilityContext } from "../contracts.js";
import { BiffFormulaWriter } from "../codecs/biff-write-formulas.js";

const position = { sheet: "s", row: 5, column: 5 };
const text = (row: number, column: number, value = "Sales"): Cell => ({ row, column, value: { kind: "string", value } });
const number = (row: number, column: number, value: number): Cell => ({ row, column, value: { kind: "number", value } });
const book = (cells: readonly Cell[]): Workbook => ({ automaticLabelLookup: true,
  sheets: [{ id: "s", name: "Sheet", size: { rows: 256, columns: 256 }, cells }] });
function bind(workbook: Workbook, grammar = odfGrammar, source = "='Sales'") {
  const result = parseExpression(source, { workbook, position, grammar });
  if (!result.ok) throw new Error(result.diagnostic.message);
  return result.document;
}

it.each([
  { name: "upper-left before closer right", matches: [[0, 0], [5, 6]], expected: [0, 0] },
  { name: "nearest upper-left", matches: [[0, 0], [3, 4]], expected: [3, 4] },
  { name: "two below, nearest wins", matches: [[10, 0], [7, 3]], expected: [7, 3] },
  { name: "two right, above wins", matches: [[10, 6], [4, 7]], expected: [4, 7] },
  { name: "two right and below, first column wins", matches: [[10, 6], [6, 7]], expected: [10, 6] },
  { name: "equal distance retains first", matches: [[3, 4], [4, 3]], expected: [4, 3] }
])("binds $name independent of sparse storage order", ({ matches, expected }) => {
  for (const coordinates of [matches, [...matches].reverse()]) {
    const document = bind(book(coordinates.map(([row, column]) => text(row!, column!))));
    expect(document.root).toMatchObject({ kind: "reference", label: { axis: "column", semantics: "openformula" }, first: {
      row: { value: expected[0], relative: false }, column: { value: expected[1]! - position.column, relative: true } } });
  }
});

it("searches declarations on another sheet before automatic matches and never searches remote automatic cells", () => {
  const workbook = book([text(4, 4)]);
  const remote = { id: "other", name: "Other", cells: [text(0, 0)], labelRanges: [{ axis: "column" as const,
    labels: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }, data: { startRow: 1, endRow: 2, startColumn: 0, endColumn: 0 } }] };
  expect(bind({ ...workbook, sheets: [...workbook.sheets, remote] }).root).toMatchObject({ first: { sheet: "Other" } });
  expect(parseExpression("='Sales'", { position, grammar: odfGrammar,
    workbook: { ...book([]), sheets: [...book([]).sheets, { ...remote, labelRanges: [] }] } }).ok).toBe(false);
  expect(parseExpression("='Sales'", { position, grammar: odfGrammar, workbook: { ...workbook, automaticLabelLookup: false } }).ok).toBe(false);
});

it.each([-1, 1])("infers a row label from vertical text at offset %s", offset => {
  expect(bind(book([text(2, 0), text(2 + offset, 0, "Other")])).root).toMatchObject({ label: { axis: "row" }, first: {
    row: { value: -3, relative: true }, column: { value: 0, relative: false } } });
});

it("keeps the OpenFormula orientation rule distinct from Calc's numeric-right extension", () => {
  const workbook = book([text(0, 0), number(0, 1, 7)]);
  expect(bind(workbook).root).toMatchObject({ label: { axis: "column", semantics: "openformula" } });
  expect(bind(workbook, legacyOpenOfficeGrammar).root).toMatchObject({ label: { axis: "row" } });
});

it("does not apply Calc's numeric-right extension at the last row", () => {
  expect(bind(book([text(255, 0), number(255, 1, 7)]), legacyOpenOfficeGrammar).root)
    .toMatchObject({ label: { axis: "column" } });
});

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 10000 } };
function result(workbook: Workbook, source: string) {
  const sheet = workbook.sheets[0]!;
  return recalculateWorkbook({ ...workbook, sheets: [{ ...sheet, cells: [...sheet.cells,
    { row: position.row, column: position.column, formula: source, formulaDirty: true, value: { kind: "number", value: 999 } }
  ] }] }, context, true).sheets[0]!.cells.at(-1)!.value;
}

it("implements the OpenFormula automatic-range example and regenerates it after filling the gap", () => {
  const workbook = book([text(0, 0), number(2, 0, 1), number(3, 0, 2), number(5, 0, 8), number(7, 0, 32)]);
  const source = serializeExpression(bind(workbook, odfGrammar, "=SUM('Sales')"), gnumericGrammar, false);
  expect(source).toBe("=SUM(@column.odf.quoted:A$1)");
  expect(result(workbook, source)).toEqual({ kind: "number", value: 3 });
  expect(result({ ...workbook, sheets: [{ ...workbook.sheets[0]!, cells: [...workbook.sheets[0]!.cells, number(4, 0, 4)] }] }, source))
    .toEqual({ kind: "number", value: 15 });
});

it("does not extend an ODF data range through a neighboring bridge", () => {
  const workbook = book([text(0, 0), number(1, 0, 2), number(3, 0, 3), number(2, 1, 100)]);
  expect(result(workbook, "=SUM(@column.odf.quoted:A$1)")).toEqual({ kind: "number", value: 2 });
  expect(result(workbook, "=SUM(@column.quoted:A$1)")).toEqual({ kind: "number", value: 5 });
});

it("transposes the one-blank skip and gap termination rule for row labels", () => {
  const workbook = book([text(0, 0), text(1, 0, "Other"), number(0, 2, 2), number(0, 3, 3), number(0, 5, 100)]);
  const source = serializeExpression(bind(workbook, odfGrammar, "=SUM('Sales')"), gnumericGrammar, false);
  expect(result(workbook, source)).toEqual({ kind: "number", value: 5 });
});

it("retains the OpenFormula range policy and cell identity through copy and move", () => {
  const workbook = book([text(0, 0), number(1, 0, 2)]);
  const source = serializeExpression(bind(workbook, odfGrammar, "=SUM('Sales')"), gnumericGrammar, false);
  const parsed = parseExpression(source, { position });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(rewriteReferences(parsed.document, { translation: "copy", position: { ...position, column: 6 } })).toBe("=SUM(@column.odf.quoted:B$1)");
  expect(rewriteReferences(parsed.document, { translation: "move", position: { ...position, column: 6 } })).toBe("=SUM(@column.odf.quoted:A$1)");
  expect(result(book([text(0, 0, "Renamed"), text(0, 1), number(1, 0, 2)]), source)).toEqual({ kind: "number", value: 2 });
});

it("does not discard OpenFormula automatic-range semantics in a BIFF label token", () => {
  const workbook = book([text(0, 0)]), writer = new BiffFormulaWriter(workbook, 8, context);
  expect(() => writer.compile("=SUM(@column.odf.quoted:$A$1)", "s", 5, 5)).toThrow("OpenFormula");
  expect(writer.compile("=SUM(@column.quoted:$A$1)", "s", 5, 5).tokens.length).toBeGreaterThan(0);
});

it("uses the formula row for scalar function arguments even beyond an automatic range's first gap", () => {
  const workbook = book([text(0, 0), number(1, 0, 2), number(5, 0, -8)]);
  for (const expression of ["=ABS('Sales')", "=ABS(('Sales'))", "='Sales'+10"]) {
    const source = serializeExpression(bind(workbook, odfGrammar, expression), gnumericGrammar, false);
    expect(result(workbook, source)).toEqual({ kind: "number", value: expression.includes("ABS") ? 8 : 2 });
  }
  const aggregate = serializeExpression(bind(workbook, odfGrammar, "=SUM('Sales')"), gnumericGrammar, false);
  expect(result(workbook, aggregate)).toEqual({ kind: "number", value: 2 });
});

it("stops at two initial blank cells and keeps huge empty sheet extents sparse", () => {
  const workbook = book([text(0, 0), number(3, 0, 9), number(1048575, 0, 100)]);
  const large = { ...workbook, sheets: [{ ...workbook.sheets[0]!, size: { rows: 1048576, columns: 16384 } }] };
  const source = serializeExpression(bind(large, odfGrammar, "=SUM('Sales')"), gnumericGrammar, false);
  expect(result(large, source)).toEqual({ kind: "number", value: 0 });
});
