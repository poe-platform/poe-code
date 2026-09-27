import { expect, it } from "vitest";
import { parseExpression } from "./parser.js";
import { rewriteReferences, visitFormula } from "./rewriting.js";
import { serializeExpression } from "./serialization.js";
import { localReferenceRange } from "./local-references.js";
import { recalculateWorkbook } from "./evaluator.js";
import { dirtyWorkbook } from "../workbook/updates/recalculation.js";
import type { Workbook } from "../workbook.js";
import type { CapabilityContext } from "../contracts.js";
import { excelGrammar } from "./conventions.js";

const position = { sheet: "S", row: 2, column: 1 };

it("parses a label's anchor and orientation without resolving away its identity", () => {
  const parsed = parseExpression("=@row:$A1", { position });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(parsed.document.root).toMatchObject({ kind: "reference", label: { axis: "row", referenceClass: "reference" },
    first: { row: { value: -2, relative: true }, column: { value: 0, relative: false } } });
  expect(serializeExpression(parsed.document, undefined, false)).toBe("=@row:$A1");
  expect(rewriteReferences(parsed.document, { translation: "copy", position: { sheet: "S", row: 3, column: 2 } })).toBe("=@row:$A2");
  expect(rewriteReferences(parsed.document, { translation: "move", position: { sheet: "S", row: 3, column: 2 } })).toBe("=@row:$A1");
});

it("preserves label value class and relative column behavior", () => {
  const parsed = parseExpression("=SUM(@column.value:A$1)", { position });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(rewriteReferences(parsed.document, { translation: "copy", position: { sheet: "S", row: 3, column: 2 } }))
    .toBe("=SUM(@column.value:B$1)");
  expect(() => serializeExpression(parsed.document, excelGrammar)).toThrow("label reference");
});

it("leaves ordinary single-quoted strings unchanged", () => {
  const parsed = parseExpression("='Sales'", { position });
  expect(parsed.ok && parsed.document.root).toMatchObject({ kind: "literal", value: { kind: "string", value: "Sales" } });
});

for (const source of ["=@column:Name", "=@row:[other]S!A1", "=@diagonal:A1"]) {
  it(`rejects an invalid label target ${source}`, () => {
    expect(parseExpression(source, { position }).ok).toBe(false);
  });
}

for (const source of ["=-@row:$A1", "=--@row:$A1", "=@row:$A1%%", "=2^@row:$A1^3", "=SUM(-@row:$A1)", "=SUM(@row:$A1+1)", "=-(@row:$A1)", "=1+-@row:$A1", "=-@row:$A1^2", "=2^3^-@row:$A1"]) {
  for (const canonical of [false, true]) it(`retains label selection while serializing ${source} (canonical=${canonical})`, () => {
    const parsed = parseExpression(source, { position });
    if (!parsed.ok) throw new Error(parsed.diagnostic.message);
    const output = parseExpression(serializeExpression(parsed.document, undefined, false, canonical), { position });
    if (!output.ok) throw new Error(output.diagnostic.message);
    const modes = (root: typeof parsed.document.root) => {
      const values: boolean[] = [];
      visitFormula(root, node => { if (node.kind === "reference" && node.label) values.push(node.label.scalar); });
      return values;
    };
    expect(modes(output.document.root)).toEqual(modes(parsed.document.root));
  });
}

it("does not expose a live label anchor as a statically resolved data reference", () => {
  const parsed = parseExpression("=@row:$A1", { position });
  if (!parsed.ok || parsed.document.root.kind !== "reference") throw new Error("Expected reference");
  expect(localReferenceRange(fixture(), parsed.document.root, position)).toBeUndefined();
});

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 1000 } };
function fixture(formula = "=SUM(@row:$A1)"): Workbook {
  return { automaticLabelLookup: true, sheets: [{ id: "S", name: "S", size: { rows: 256, columns: 256 }, cells: [
    { row: 0, column: 0, value: { kind: "string", value: "Sales" } },
    { row: 0, column: 1, value: { kind: "number", value: 2 } },
    { row: 0, column: 2, value: { kind: "number", value: 3 } },
    { row: 0, column: 4, value: { kind: "number", value: 100 } },
    { row: 2, column: 1, formula, value: { kind: "number", value: 999 }, formulaDirty: true }
  ] }] };
}
const result = (book: Workbook) => recalculateWorkbook(book, context, true).sheets[0]!.cells.find(cell => cell.formula)!.value;

it("uses the first declared range even with numeric labels and automatic lookup disabled", () => {
  const book = fixture(), sheet = book.sheets[0]!;
  const labels = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
  const data = { startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 };
  expect(result({ ...book, automaticLabelLookup: false, sheets: [{ ...sheet,
    cells: sheet.cells.map(cell => cell.column === 0 ? { ...cell, value: { kind: "number", value: 5 } } : cell),
    labelRanges: [{ axis: "row", labels, data }, { axis: "row", labels, data: { ...data, startColumn: 4, endColumn: 4 } }] }] }))
    .toEqual({ kind: "number", value: 2 });
});

it("returns NAME for a numeric undeclared label and REF for a missing scalar intersection", () => {
  const book = fixture(), sheet = book.sheets[0]!;
  expect(result({ ...book, sheets: [{ ...sheet, cells: sheet.cells.map(cell => cell.column === 0 ? { ...cell, value: { kind: "number", value: 5 } } : cell) }] }))
    .toEqual({ kind: "error", value: "#NAME?" });
  expect(result({ ...book, sheets: [{ ...sheet, cells: sheet.cells.map(cell => cell.formula ? { ...cell, column: 0, formula: "=@row:$A1" } : cell) }] }))
    .toEqual({ kind: "error", value: "#REF!" });
});

it("expands through a diagonal bridge without adding the bridge cell to a row sum", () => {
  const book = fixture(), sheet = book.sheets[0]!;
  expect(result({ ...book, sheets: [{ ...sheet, cells: [...sheet.cells, { row: 1, column: 3, value: { kind: "number", value: 50 } }] }] }))
    .toEqual({ kind: "number", value: 105 });
});

it("excludes the formula itself when directly beside a row label", () => {
  const book = fixture(), sheet = book.sheets[0]!;
  expect(result({ ...book, sheets: [{ ...sheet, cells: sheet.cells.filter(cell => cell.column !== 1 || cell.formula).map(cell => cell.formula ? { ...cell, row: 0 } : cell) }] }))
    .toEqual({ kind: "number", value: 3 });
});

it("dirties labels after a newly occupied cell bridges a former data gap", () => {
  const clean = recalculateWorkbook(fixture(), context, true);
  const book = { ...clean, sheets: clean.sheets.map(sheet => ({ ...sheet, cells: [...sheet.cells,
    { row: 0, column: 3, value: { kind: "number" as const, value: 10 } }] })) };
  const dirty = dirtyWorkbook(book, [{ sheet: "S", startRow: 0, endRow: 0, startColumn: 3, endColumn: 3 }], context);
  expect(dirty.sheets[0]!.cells.find(cell => cell.formula)!.formulaDirty).toBe(true);
  expect(recalculateWorkbook(dirty, context, { force: false, queueVolatile: false }).sheets[0]!.cells.find(cell => cell.formula)!.value)
    .toEqual({ kind: "number", value: 115 });
});

it("tracks data edits during cell-at-a-time evaluation", () => {
  const clean = recalculateWorkbook(fixture(), context, true);
  const book = { ...clean, sheets: clean.sheets.map(sheet => ({ ...sheet, cells: sheet.cells.map(cell =>
    cell.row === 0 && cell.column === 1 ? { ...cell, value: { kind: "number" as const, value: 7 } } : cell) })) };
  expect(recalculateWorkbook(book, context, false, undefined, { changed: { sheet: "S", row: 0, column: 1 }, target: position })
    .sheets[0]!.cells.find(cell => cell.formula)!.value).toEqual({ kind: "number", value: 10 });
});

it("recalculates live labels inside a named expression at its caller", () => {
  expect(result({ ...fixture("=SalesTotal"), names: [{ name: "SalesTotal", expression: "=SUM(@row:$A1)", position }] }))
    .toEqual({ kind: "number", value: 5 });
});

it("bounds automatic-region scanning and preserves caller cancellation", () => {
  expect(() => recalculateWorkbook(fixture(), { ...context, limits: { ...context.limits, workbookWork: 20 } }, true))
    .toThrow("work limit");
  const controller = new AbortController(); controller.abort(null);
  let caught: unknown = "not thrown";
  try { recalculateWorkbook(fixture(), { ...context, signal: controller.signal }, true); } catch (error) { caught = error; }
  expect(caught).toBe(null);
});

for (const kind of ["shared", "array"] as const) it(`evaluates ${kind} groups with live label references`, () => {
  const book = fixture(), sheet = book.sheets[0]!;
  const output = recalculateWorkbook({ ...book, sheets: [{ ...sheet,
    cells: sheet.cells.filter(cell => !cell.formula),
    formulaGroups: [{ id: "labels", kind, expression: "=SUM(@row:$A1)", range: { startRow: 2, endRow: 2, startColumn: 1, endColumn: 2 } }]
  }] }, context, true);
  expect(output.sheets[0]!.cells.filter(cell => cell.formula).map(cell => cell.value)).toEqual([
    { kind: "number", value: 5 }, { kind: "number", value: 5 }
  ]);
});
