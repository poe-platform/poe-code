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

it.each(["='Missing'!$Value", '=INDIRECT("Missing!$Value")', '=@name.relative[0,0,0]:"Nested"'])("does not bind a missing qualified sheet to a global name: %s", formula => {
  const input = { ...book, names: [...book.names!, { name: "Nested", expression: "='Missing'!$Value" }] };
  expect(result(formula, input)).toEqual({ kind: "error", value: formula.startsWith("=INDIRECT") ? "#REF!" : "#NAME?" });
  const restored = { ...input, sheets: [...input.sheets, { id: "missing", name: "Missing", cells: [] }] };
  expect(result(formula, restored)).toEqual({ kind: "number", value: 11 });
  const scoped = { ...restored, names: [...restored.names, { name: "$Value", sheet: "missing", expression: "=29" }] };
  if (!formula.startsWith("=INDIRECT")) expect(result(formula, scoped)).toEqual({ kind: "number", value: 29 });
});
it.each(["='Missing'!$Value", '=INDIRECT("Missing!$Value")', '=@name.relative[0,0,0]:"Nested"'])("does not discover global precedents through a missing qualified sheet: %s", formula => {
  const cell = { row: 2, column: 2, formula, value: { kind: "blank" as const } };
  const input = { ...book, names: [...book.names!, { name: "Nested", expression: "='Missing'!$Value" }], sheets: book.sheets.map(sheet => sheet.id === "s0" ? { ...sheet, cells: [...sheet.cells, cell] } : sheet) };
  const parse = (source: string, at: typeof position) => {
    const parsed = parseExpression(source, { position: at, workbook: input });
    if (!parsed.ok) throw new Error(parsed.diagnostic.message);
    return parsed.document.root;
  };
  const graph = buildDependencyGraph(input, new Map([[cell, parse(cell.formula, position)]]),
    (node, at) => localReferenceRange(input, node, at), parse, () => {});
  expect([...graph.precedents.get(cell) ?? []]).toEqual([]);
});

it.each(["relative", "absolute"])("preserves displaced name sheet identity through tab reorder (%s)", mode => {
  const input: Workbook = { names: [{ name: "Value", expression: "='First'!$A$1" }], sheets: ["First", "Second", "Third"].map((name, i) => ({
    id: `s${i}`, name, cells: [{ row: 0, column: 0, value: { kind: "number", value: 11 + i } },
      ...(i === 2 ? [{ row: 2, column: 2, formula: `=@name.${mode}[0,0,1]:"Value"`, value: { kind: "blank" as const } }] : [])]
  })) };
  const value = (book: Workbook) => recalculateWorkbook(book, context, true).sheets.find(s => s.id === "s2")!.cells.find(c => c.formula)!.value;
  expect(value(input)).toEqual({ kind: "number", value: 12 });
  const moved = moveWorkbookSheet(input, "s1", 2, context);
  expect(value(moved)).toEqual({ kind: "number", value: 12 });
  expect(value({ ...moved, names: [] })).toEqual({ kind: "error", value: "#NAME?" });
  expect(value(moveWorkbookSheet(moved, "s1", 1, context))).toEqual({ kind: "number", value: 12 });
});

it("renames both sides of a reordered name mapping and keeps later definition edits live", () => {
  const formula = '=@name.absolute[0,0,0].sheets["First","Second","Second",null]:"$Value"';
  const input: Workbook = { ...book, sheets: book.sheets.map((sheet, i) => i ? sheet : { ...sheet,
    cells: [...sheet.cells, { ...position, formula, value: { kind: "blank" } }] }) };
  const renamed = renameWorkbookSheet(renameWorkbookSheet(input, "s1", "O'Brian", context), "s0", "Start", context);
  expect(result(renamed.sheets[0]!.cells.find(c => c.formula)!.formula!, renamed, { ...position, row: 4 })).toEqual({ kind: "number", value: 12 });
  expect(result(formula, { ...book, names: [{ name: "$Value", expression: "='First'!$B$1" }] })).toEqual({ kind: "number", value: 14 });
  expect(result(formula, { ...book, names: [{ name: "$Value", expression: "='Second'!$A$1" }] })).toEqual({ kind: "error", value: "#REF!" });
});
it("composes nested live name sheet mappings in evaluation order", () => {
  const input: Workbook = { ...book, names: [
    { name: "Inner", expression: "='First'!$A$1" },
    { name: "Outer", expression: '=@name.absolute[0,0,0].sheets["First","Second","Second",null]:"Inner"' }
  ] };
  expect(result('=@name.absolute[0,0,-1]:"Outer"', input)).toEqual({ kind: "number", value: 11 });
});
it("keeps ordinary unsupported formula syntax untouched during tab moves", () => {
  const input: Workbook = { ...book, sheets: book.sheets.map(sheet => ({ ...sheet, cells: [
    { row: 0, column: 0, formula: "=)", value: { kind: "number", value: 7 } }
  ] })) };
  expect(moveWorkbookSheet(input, "s0", 1, context).sheets[1]!.cells[0]!.formula).toBe("=)");
});
it.each([
  '.sheets[]', '.sheets["First"]', '.sheets["First",false]', '.sheets["First",""]',
  '.sheets["First","Second","FIRST",null]', '.sheets["First","Second",]'
])("rejects invalid name mapping %s", suffix => {
  expect(parseExpression(`=@name.absolute[0,0,0]${suffix}:"N"`, { position }).ok).toBe(false);
});
it("charges retained sheet mapping entries to the parser node budget", () => {
  expect(() => parseExpression('=@name.absolute[0,0,0].sheets["First","Second"]:"N"', { position, maximumNodes: 1 })).toThrow("node limit");
});

it("copies mapped names using current tab order and retains invalid mapped targets", () => {
  const input: Workbook = { ...book, sheets: [...book.sheets, { id: "s2", name: "Third", cells: [
    { row: 0, column: 0, value: { kind: "number", value: 31 } }
  ] }] };
  const source = '=@name.absolute[0,0,0].sheets["First","Second","Second",null]:"$Value"';
  const parsed = parseExpression(source, { position, workbook: input });
  expect(parsed.ok).toBe(true); if (!parsed.ok) return;
  const at = { ...position, sheet: "s1" };
  const copy = rewriteReferences(parsed.document, { translation: "copy", position: at });
  expect(result(copy, input, at)).toEqual({ kind: "number", value: 31 });
  const moved = rewriteReferences(parsed.document, { translation: "move", position: at });
  expect(result(moved, input, at)).toEqual({ kind: "number", value: 12 });
  expect(result(copy, { ...input, names: [{ name: "$Value", expression: "='Second'!$A$1" }] }, at))
    .toEqual({ kind: "error", value: "#REF!" });
});
it("roundtrips quoted sheet mappings through internal OpenFormula", () => {
  const source = '=@name.relative[1,2,-1].sheets["First","O\\"Brien","Second",null]:"N"';
  const parsed = parseExpression(source, { position, workbook: book });
  expect(parsed.ok).toBe(true); if (!parsed.ok) return;
  const restored = parseExpression(serializeExpression(parsed.document, internalOdfGrammar, false), { position, workbook: book });
  expect(restored.ok && restored.document.root.kind === "name" && restored.document.root.relocation)
    .toEqual(parsed.document.root.kind === "name" && parsed.document.root.relocation);
  expect(() => serializeExpression(parsed.document, excelGrammar, false)).toThrow("live name");
});
it("bounds mapping evaluation work and preserves cancellation", () => {
  const formula = '=@name.absolute[0,0,0].sheets["First","Second"]:"$Value"';
  const input = { ...book, sheets: book.sheets.map(sheet => ({ ...sheet, cells: [
    { row: 2, column: 2, formula, value: { kind: "blank" as const } }
  ] })) };
  expect(() => recalculateWorkbook(input, { ...context, limits: { ...context.limits, workbookWork: 1 } }, true)).toThrow("limit");
  const controller = new AbortController(), reason = new Error("cancel name mapping");
  controller.abort(reason);
  expect(() => moveWorkbookSheet(input, "s0", 1, { ...context, signal: controller.signal })).toThrow(reason);
});
