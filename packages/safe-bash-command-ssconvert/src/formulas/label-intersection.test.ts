import { expect, it } from "vitest";
import { parseExpression } from "./parser.js";
import { serializeExpression } from "./serialization.js";
import { gnumericGrammar, odfGrammar } from "./conventions.js";
import { recalculateWorkbook } from "./evaluator.js";
import { rewriteReferences } from "./rewriting.js";
import type { Workbook } from "../workbook.js";
import type { CapabilityContext } from "../contracts.js";
import { nativeOpenFormula } from "../codecs/formula-semantics.js";

const position = { sheet: "S", row: 7, column: 7 };
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 3, operations: 10000 } };
function book(): Workbook {
  return { automaticLabelLookup: false, sheets: [{ id: "S", name: "S", cells: [
    { row: 0, column: 1, value: { kind: "string", value: "Sales" } },
    { row: 2, column: 0, value: { kind: "string", value: "West" } },
    { row: 2, column: 1, value: { kind: "number", value: 7 } },
    { row: 2, column: 2, value: { kind: "number", value: 11 } }
  ], labelRanges: [
    { axis: "column", labels: { startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 },
      data: { startRow: 1, endRow: 5, startColumn: 1, endColumn: 1 } },
    { axis: "row", labels: { startRow: 2, endRow: 2, startColumn: 0, endColumn: 0 },
      data: { startRow: 2, endRow: 2, startColumn: 1, endColumn: 3 } }
  ] }] };
}
function parsed(source: string, workbook = book()) {
  const result = parseExpression(source, { workbook, position, grammar: odfGrammar });
  if (!result.ok) throw new Error(result.diagnostic.message);
  return result.document;
}
function result(source: string, workbook = book()) {
  const sheet = workbook.sheets[0]!;
  return recalculateWorkbook({ ...workbook, sheets: [{ ...sheet, cells: [...sheet.cells,
    { row: 7, column: 7, formula: source, value: { kind: "number", value: 999 }, formulaDirty: true }
  ] }, ...workbook.sheets.slice(1)] }, context, true).sheets[0]!.cells.at(-1)!.value;
}

it.each(["='Sales'!!'West'", "='West' !! 'Sales'", "=SUM('Sales'!!'West')", "=('Sales'!!'West')+1"])(
  "binds and evaluates the strict automatic intersection %s", source => {
    const document = parsed(source);
    const internal = serializeExpression(document, gnumericGrammar, false);
    expect(internal).toContain("!!");
    expect(internal).toContain("@column.odf.quoted:B$1");
    expect(internal).toContain("@row.odf.quoted:$A3");
    expect(result(internal)).toEqual({ kind: "number", value: source.endsWith("+1") ? 8 : 7 });
  });

it("keeps automatic intersection distinct from ordinary reference intersection", () => {
  expect(parsed("='Sales'!!'West'").root).toMatchObject({ kind: "binary", op: "label-intersection",
    left: { label: { scalar: false } }, right: { label: { scalar: false } } });
  expect(parsed("=[.B2:.B6]![.B3:.D3]").root).toMatchObject({ kind: "binary", op: "intersection" });
});

it.each(["=[.B3]!!'West'", "='Sales'!![.B3]", "=SUM('Sales')!!'West'", "=('Sales')!!'West'", "='Sales'!!'West'!!'Sales'", "='Sales'!!#REF!"])(
  "rejects operands outside the QuotedLabel grammar: %s", source => {
    expect(parseExpression(source, { workbook: book(), position, grammar: odfGrammar }).ok).toBe(false);
  });

it("reports an error for two labels with the same orientation", () => {
  expect(result(serializeExpression(parsed("='Sales'!!'Sales'"), gnumericGrammar, false)))
    .toEqual({ kind: "error", value: "#VALUE!" });
});

it("reports an empty intersection rather than returning either data range", () => {
  const workbook = book(), sheet = workbook.sheets[0]!, pair = sheet.labelRanges![0]!;
  const disjoint = { ...workbook, sheets: [{ ...sheet, labelRanges: [{ ...pair, data: { ...pair.data, endRow: 1 } }, sheet.labelRanges![1]!] }] };
  expect(result(serializeExpression(parsed("='Sales'!!'West'", disjoint), gnumericGrammar, false), disjoint))
    .toEqual({ kind: "error", value: "#NULL!" });
});

it("rejects intersections of labels bound to different sheets", () => {
  const workbook = book(), sheet = workbook.sheets[0]!;
  const split: Workbook = { ...workbook, sheets: [
    { ...sheet, labelRanges: [sheet.labelRanges![0]!] },
    { ...sheet, id: "Other", name: "Other", labelRanges: [sheet.labelRanges![1]!] }
  ] };
  expect(result(serializeExpression(parsed("='Sales'!!'West'", split), gnumericGrammar, false), split))
    .toEqual({ kind: "error", value: "#VALUE!" });
});

it("uses enabled automatic label lookup and its data ranges", () => {
  const workbook = book(), sheet = workbook.sheets[0]!;
  const automatic: Workbook = { ...workbook, automaticLabelLookup: true, sheets: [{ ...sheet, labelRanges: [], cells: [
    ...sheet.cells, { row: 3, column: 0, value: { kind: "string", value: "Other" } }
  ] }] };
  expect(result(serializeExpression(parsed("='Sales'!!'West'", automatic), gnumericGrammar, false), automatic))
    .toEqual({ kind: "number", value: 7 });
});

it("preserves both captured anchors through text edits, copy and move", () => {
  const source = serializeExpression(parsed("='Sales'!!'West'"), gnumericGrammar, false);
  const document = parseExpression(source, { position });
  if (!document.ok) throw new Error(document.diagnostic.message);
  expect(rewriteReferences(document.document, { translation: "copy", position: { ...position, row: 8, column: 8 } }))
    .toBe("=@column.odf.quoted:C$1!!@row.odf.quoted:$A4");
  expect(rewriteReferences(document.document, { translation: "move", position: { ...position, row: 8, column: 8 } }))
    .toBe("=@column.odf.quoted:B$1!!@row.odf.quoted:$A3");
  const workbook = book();
  expect(result(source, { ...workbook, sheets: workbook.sheets.map(sheet => ({ ...sheet,
    cells: sheet.cells.map(cell => cell.value.kind === "string" ? { ...cell, value: { kind: "string", value: "Renamed" } } : cell)
  })) })).toEqual({ kind: "number", value: 7 });
});

it("keeps a deleted anchor's error and the remaining live label through rewriting", () => {
  const source = serializeExpression(parsed("='Sales'!!'West'"), gnumericGrammar, false);
  const document = parseExpression(source, { position });
  if (!document.ok) throw new Error(document.diagnostic.message);
  const removed = rewriteReferences(document.document, { endpoint(ref) {
    return ref.column?.relative ? { ...ref, row: { value: -1, relative: false } } : ref;
  } });
  expect(removed).toBe("=#REF!!!@row.odf.quoted:$A3");
  expect(result(removed)).toEqual({ kind: "error", value: "#REF!" });
  const both = rewriteReferences(document.document, { translation: "copy", position: { sheet: "S", row: 0, column: 0 } });
  expect(result(both)).toEqual({ kind: "error", value: "#REF!" });
});

it("treats automatic intersection as a primary expression before range and postfix operators", () => {
  const source = serializeExpression(parsed("=SUM('Sales'!!'West':[.C3])"), gnumericGrammar, false);
  expect(result(source)).toEqual({ kind: "number", value: 18 });
  const percent = serializeExpression(parsed("='Sales'!!'West'%"), gnumericGrammar, false);
  expect(result(percent)).toEqual({ kind: "number", value: 0.07 });
});

it("does not publish internal deleted-label intersection syntax as native formula text", () => {
  const source = "=#REF!!!#REF!", document = parseExpression(source, { position });
  if (!document.ok) throw new Error(document.diagnostic.message);
  expect(() => nativeOpenFormula(source, position, context)).toThrow("automatic label intersection");
  expect(() => serializeExpression(document.document, odfGrammar, false)).toThrow("automatic label intersection");
  expect(nativeOpenFormula('="!!"', position, context)).toBe('="!!"');
});
