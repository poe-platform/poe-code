import { expect, it } from "vitest";
import type { Workbook } from "@poe-code/spreadsheet-ast";
import type { CapabilityContext } from "../contracts.js";
import { parseExpression } from "./parser.js";
import { serializeExpression } from "./serialization.js";
import { rewriteReferences } from "./rewriting.js";
import { recalculateWorkbook } from "./evaluator.js";
import { excelGrammar, internalOdfGrammar } from "./conventions.js";
import { buildDependencyGraph } from "./dependencies.js";
import { localReferenceRange } from "./local-references.js";
import { renameWorkbookSheet, moveWorkbookSheet } from "./workbook.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 1000, sheets: 4, operations: 1000, workbookWork: 100000 } };
const position = { sheet: "s0", row: 2, column: 2 };
const book: Workbook = { names: [{ name: "$Value", expression: "='First'!$A$1" }], sheets: ["First", "Second"].map((name, i) => ({
  id: `s${i}`, name, cells: [
    { row: 0, column: 0, value: { kind: "number", value: 11 + i } },
    { row: 0, column: 1, value: { kind: "number", value: 13 + i } },
    { row: 1, column: 1, value: { kind: "number", value: 17 + i } }
  ]
})) };
function result(formula: string, input = book, at = position) {
  const calculated = recalculateWorkbook({ ...input, sheets: input.sheets.map(sheet => sheet.id !== at.sheet ? sheet : { ...sheet,
    cells: [...sheet.cells, { row: at.row, column: at.column, formula, value: { kind: "blank" } }] }) }, context, true);
  return calculated.sheets.find(sheet => sheet.id === at.sheet)!.cells.find(cell => cell.row === at.row && cell.column === at.column)!.value;
}

it.each(["relative", "absolute"])("keeps exact live name identity in %s references", mode => {
  const formula = `=@name.${mode}[0,0,0]:"$Value"`;
  expect(result(formula)).toEqual({ kind: "number", value: 11 });
  expect(result(formula, { ...book, names: [{ name: "$Value", expression: "='First'!$B$1" }] })).toEqual({ kind: "number", value: 13 });
  expect(result(formula, { ...book, names: [] })).toEqual({ kind: "error", value: "#NAME?" });
});
it.each(["relative", "absolute"])("copies and moves %s name references independently of definition edits", mode => {
  const parsed = parseExpression(`=@name.${mode}[0,0,0]:"$Value"`, { position, workbook: book });
  expect(parsed.ok).toBe(true); if (!parsed.ok) return;
  const target = { sheet: "s1", row: 3, column: 3 };
  const copied = rewriteReferences(parsed.document, { translation: "copy", position: target });
  expect(result(copied, book, target)).toEqual({ kind: "number", value: mode === "relative" ? 18 : 12 });
  const moved = rewriteReferences(parsed.document, { translation: "move", position: target });
  expect(result(moved, book, target)).toEqual({ kind: "number", value: 11 });
});
it("preserves live names in internal grammar translation and rejects lossy native output", () => {
  const parsed = parseExpression('=@name.relative[-1,2,0]:"O\\"Brien é"', { position });
  expect(parsed.ok).toBe(true); if (!parsed.ok) return;
  const source = serializeExpression(parsed.document, internalOdfGrammar, false);
  const restored = parseExpression(source, { position });
  expect(restored.ok && restored.document.root).toMatchObject({ kind: "name", name: 'O"Brien é' });
  expect(() => serializeExpression(parsed.document, excelGrammar, false)).toThrow("live name");
});
it("uses the changed definition for dependency discovery after a copy", () => {
  const input = { ...book, names: [{ name: "$Value", expression: "='First'!$A$1:$A$2" }] };
  const formula = '=@name.relative[0,1,1]:"$Value"';
  const cell = { row: 2, column: 2, formula, value: { kind: "blank" as const } };
  const copied = { ...input, sheets: input.sheets.map(sheet => sheet.id === "s0" ? { ...sheet, cells: [...sheet.cells, cell] } : sheet) };
  const parse = (source: string, at: typeof position) => {
    const parsed = parseExpression(source, { position: at, workbook: copied });
    if (!parsed.ok) throw new Error(parsed.diagnostic.message);
    return parsed.document.root;
  };
  const graph = buildDependencyGraph(copied, new Map([[cell, parse(formula, position)]]),
    (node, at) => localReferenceRange(copied, node, at), parse, () => {});
  expect([...graph.precedents.get(cell) ?? []]).toEqual([book.sheets[1]!.cells[1], book.sheets[1]!.cells[2]]);
});
it("follows nested definitions, preserves global scope and detects cycles", () => {
  const formula = '=@name.relative[0,1,0]:"Nested"';
  const names = [...book.names!, { name: "Nested", expression: "=[]$Value" }, { name: "$Value", sheet: "s0", expression: "=99" }];
  expect(result(formula, { ...book, names })).toEqual({ kind: "number", value: 13 });
  expect(result(formula, { ...book, names: [{ name: "Nested", expression: "=Nested" }] })).toEqual({ kind: "error", value: "#NAME?" });
});
it("keeps definition targets after sheet rename and reordering", () => {
  const renamed = renameWorkbookSheet(book, "s0", "O'Brian", context);
  const moved = moveWorkbookSheet(renamed, "s0", 1, context);
  expect(result('=@name.relative[0,0,0]:"$Value"', moved)).toEqual({ kind: "number", value: 11 });
});
it.each(['=@name.relative[-1,0,0]:"$Value"', '=@name.relative[0,0,-1]:"$Value"', '=@name.relative[0,0,2]:"$Value"'])("reports displaced reference bounds for %s", formula => {
  expect(result(formula)).toEqual({ kind: "error", value: "#REF!" });
});
it("charges parsing and declaration traversal and preserves cancellation", () => {
  const source = '=@name.relative[0,0,0]:"$Value"';
  expect(() => parseExpression(source, { position, maximumNodes: 0 })).toThrow("node limit");
  const controller = new AbortController(), reason = new Error("stop live names");
  controller.abort(reason);
  expect(() => parseExpression(source, { position, signal: controller.signal })).toThrow(reason);
});
it("can copy row and column offsets while keeping an explicitly qualified name target's sheet", () => {
  const parsed = parseExpression('=@name.relative.fixed-sheet[0,0,0]:"$Value"', { position, workbook: book });
  expect(parsed.ok).toBe(true); if (!parsed.ok) return;
  const target = { sheet: "s1", row: 3, column: 3 };
  const copied = rewriteReferences(parsed.document, { translation: "copy", position: target });
  expect(result(copied, book, target)).toEqual({ kind: "number", value: 17 });
});
it.each(['=@name.relative[0,0]:"N"', '=@name.relative[0,0,1.5]:"N"', '=@name.absolute[1,0,0]:"N"',
  '=@name.relative[9007199254740992,0,0]:"N"', '=@name.relative[0,0,0]:""'])("rejects invalid live name spelling %s", source => {
  expect(parseExpression(source, { position }).ok).toBe(false);
});
