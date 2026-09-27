import { expect, it } from "vitest";
import { parseExpression } from "./parser.js";
import { serializeExpression } from "./serialization.js";
import { rewriteReferences } from "./rewriting.js";
import { gnumericGrammar, legacyApplixGrammar, odfGrammar } from "./conventions.js";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { setCellText } from "../workbook/updates/index.js";

const position = { sheet: "s0", row: 1, column: 1 };
const workbook: Workbook = { sheets: ["First", "Second", "Third"].map((name, index) => ({
  id: `s${index}`, name, cells: [{ row: 0, column: 0, value: { kind: "number", value: 10 + index } }]
})) };
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 8, operations: 1000 } };

it.each([
  ["of:=[Second.A1]", true, "of:=['Second'.A1]"],
  ["of:=[$Second.A1]", false, "of:=[$'Second'.A1]"],
  ["of:=[$'Second'.A1]", false, "of:=[$'Second'.A1]"]
])("retains Calc's sheet relativity for %s", (source, relative, output) => {
  const result = parseExpression(source, { position, workbook, grammar: odfGrammar });
  if (!result.ok) throw new Error(result.diagnostic.message);
  expect(result.document.root).toMatchObject({ kind: "reference", first: { sheet: "Second", sheetRelative: relative } });
  expect(serializeExpression(result.document, odfGrammar, false)).toBe(output);
});

it("keeps a mixed range's sheet flags independent", () => {
  const result = parseExpression("of:=[$Second.A1:Second.B2]", { position, workbook });
  if (!result.ok) throw new Error(result.diagnostic.message);
  expect(result.document.root).toMatchObject({ kind: "reference", first: { sheetRelative: false }, last: { sheetRelative: true } });
  expect(serializeExpression(result.document, odfGrammar, false)).toBe("of:=[$'Second'.A1:'Second'.B2]");
});

it("forces an external sheet absolute while preserving relative cell axes", () => {
  const result = parseExpression("of:=['book.ods'#Second.A1]", { position, workbook });
  if (!result.ok) throw new Error(result.diagnostic.message);
  expect(result.document.root).toMatchObject({ kind: "reference", first: { sheetRelative: false, workbook: "book.ods", row: { relative: true } } });
});

it("copies relative sheet targets by tab offset and moves them by identity", () => {
  const result = parseExpression("of:=[Second.A1]+[$Second.A1]", { position, workbook });
  if (!result.ok) throw new Error(result.diagnostic.message);
  const target = { ...position, sheet: "s1" };
  expect(rewriteReferences(result.document, { position: target, translation: "copy" })).toBe("of:=['Third'.A1]+[$Second.A1]");
  expect(rewriteReferences(result.document, { position: target, translation: "move" })).toBe(result.document.source);
});

it.each([gnumericGrammar, legacyApplixGrammar])("refuses silent sheet-relativity loss in $id syntax", grammar => {
  const result = parseExpression("of:=[Second.A1]", { position, workbook });
  if (!result.ok) throw new Error(result.diagnostic.message);
  expect(() => serializeExpression(result.document, grammar, false)).toThrow("relative sheet");
});

it("applies an explicit fixed-sheet conversion even when source preservation is requested", () => {
  const result = parseExpression("of:=[Second.A1]", { position, workbook });
  if (!result.ok) throw new Error(result.diagnostic.message);
  expect(serializeExpression(result.document, odfGrammar, true, false, { relativeSheets: "fixed" })).toBe("of:=[$'Second'.A1]");
});

it("turns an out-of-workbook relative copy into a reference error", () => {
  const result = parseExpression("of:=[Third.A1]+1", { position, workbook });
  if (!result.ok) throw new Error(result.diagnostic.message);
  expect(rewriteReferences(result.document, { position: { ...position, sheet: "s1" }, translation: "copy" })).toBe("of:=[#REF!]+1");
});

it("inherits an omitted endpoint's absolute sheet flag", () => {
  const result = parseExpression("of:=[$Second.A1:.B2]", { position, workbook });
  if (!result.ok) throw new Error(result.diagnostic.message);
  expect(result.document.root).toMatchObject({ kind: "reference", first: { sheetRelative: false }, last: { sheetRelative: false } });
});

it("accepts OpenFormula through the shared text-update path", () => {
  const range = { sheet: "s0", startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 };
  const updated = setCellText(workbook, range, "of:=[Second.$A$1]", context);
  expect(updated.sheets[0]!.cells[1]!.formula).toBe("of:=[Second.$A$1]");
  expect(recalculateWorkbook(updated, context, true).sheets[0]!.cells[1]!.value).toEqual({ kind: "number", value: 11 });
});

it("evaluates relative-sheet names at their declaration anchor and caller sheet", () => {
  const book: Workbook = { ...workbook, names: [
    { name: "Relative", expression: "of:=[Second.$A$1]", position },
    { name: "Absolute", expression: "of:=[$Second.$A$1]", position }
  ], sheets: workbook.sheets.map((sheet, index) => ({ ...sheet, cells: [...sheet.cells,
    ...(index === 1 ? [{ row: 1, column: 1, formula: "=Relative*100+Absolute", value: { kind: "blank" as const } }] : [])] })) };
  expect(recalculateWorkbook(book, context, true).sheets[1]!.cells[1]!.value).toEqual({ kind: "number", value: 1211 });
});
