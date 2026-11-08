import { expect, it } from "vitest";
import { createOdfWriter, readOdf } from "./odf.js";
import { context, unpackOdf } from "./odf-write.test.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import type { Workbook } from "../workbook.js";
import { parseExpression } from "../formulas/parser.js";
import { rewriteReferences } from "../formulas/rewriting.js";

function book(formula = "=SUM(@column.odf.quoted:B$1)"): Workbook {
  return { automaticLabelLookup: false, sheets: [{ id: "stable", name: "O'Brien", cells: [
    { row: 0, column: 1, value: { kind: "string", value: "Sales" } },
    { row: 1, column: 1, value: { kind: "number", value: 2 } },
    { row: 2, column: 0, value: { kind: "string", value: "West" } },
    { row: 2, column: 1, value: { kind: "number", value: 7 } },
    { row: 7, column: 7, formula, formulaDirty: true, value: { kind: "number", value: 999 } }
  ], labelRanges: [
    { axis: "column", labels: { startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 },
      data: { startRow: 1, endRow: 5, startColumn: 1, endColumn: 1 } },
    { axis: "row", labels: { startRow: 2, endRow: 2, startColumn: 0, endColumn: 0 },
      data: { startRow: 2, endRow: 2, startColumn: 1, endColumn: 7 } }
  ] }] };
}
const value = (workbook: Workbook) => recalculateWorkbook(workbook, context, true).sheets[0]!.cells.find(c => c.row === 7 && c.column === 7)!.value;

it.each(["strict", "extended"] as const)("exports %s native declared labels and keeps captured identity through renamed text", async profile => {
  const original = book(), sheet = original.sheets[0]!;
  const renamed = { ...original, sheets: [{ ...sheet, cells: sheet.cells.map(c => c.row === 0 ?
    { ...c, value: { kind: "string" as const, value: "O'Brien's Sales" } } : c) }] };
  const bytes = await createOdfWriter(profile)(renamed, [], context), xml = (await unpackOdf(bytes)).parts.get("content.xml")!;
  expect(xml).toContain('table:formula="of:=SUM(\'O\'\'Brien\'\'s Sales\')"');
  expect(xml).not.toContain("@column");
  const reopened = await readOdf(bytes, context);
  expect(reopened.sheets[0]!.cells.find(c => c.formula)?.formula).toBe("=SUM(@column.odf.quoted:B$1)");
  expect(value(reopened)).toEqual({ kind: "number", value: 9 });
  const edited = { ...reopened, sheets: reopened.sheets.map(s => ({ ...s, cells: [...s.cells,
    { row: 4, column: 1, value: { kind: "number" as const, value: 19 } }] })) };
  expect(value(await readOdf(await createOdfWriter(profile)(edited, [], context), context))).toEqual({ kind: "number", value: 28 });
});

it.each([
  ["=@column.odf.quoted:B$1!!@row.odf.quoted:$A3", "of:='Sales'!!'West'", 7],
  ["=SUM((@column.odf.quoted:B$1!!@row.odf.quoted:$A3):C3)", "of:=SUM(('Sales'!!'West'):[.C3])", 7],
  ["=@row.odf.quoted:$A3+1", "of:='West'+1", 1],
  ["=SUM(@row.odf.quoted:$A3)", "of:=SUM('West')", 7]
])("preserves native label expression %s", async (formula, native, expected) => {
  const bytes = await createOdfWriter("strict")(book(formula as string), [], context);
  expect((await unpackOdf(bytes)).parts.get("content.xml")).toContain(`table:formula="${native}"`);
  expect(value(await readOdf(bytes, context))).toEqual({ kind: "number", value: expected });
});

it("retains automatic contiguous ranges after native export", async () => {
  const original = book(), sheet = original.sheets[0]!;
  const automatic = { ...original, automaticLabelLookup: true, sheets: [{ ...sheet, labelRanges: [], cells: [...sheet.cells,
    { row: 5, column: 1, value: { kind: "number" as const, value: 100 } }] }] };
  const reopened = await readOdf(await createOdfWriter("strict")(automatic, [], context), context);
  expect(value(reopened)).toEqual({ kind: "number", value: 9 });
  expect(reopened.sheets[0]!.cells.find(c => c.formula)?.formula).toContain(".odf.quoted:");
});

it("exports a forward remote-sheet declaration without replacing the label by its data range", async () => {
  const original = book(), data = original.sheets[0]!;
  const remote: Workbook = { ...original, sheets: [{ id: "output", name: "Output", cells: [
    { row: 7, column: 7, formula: "=SUM(@column.odf.quoted:'O\\'Brien'!B$1)", value: { kind: "number", value: 999 } }
  ] }, { ...data, cells: data.cells.filter(c => !c.formula) }] };
  const reopened = await readOdf(await createOdfWriter("strict")(remote, [], context), context);
  expect(reopened.sheets[0]!.cells[0]!.formula).toContain("@column.odf.quoted:");
  expect(value(reopened)).toEqual({ kind: "number", value: 9 });
});

it("retains label formulas in native array groups", async () => {
  const expression = "=SUM(@column.odf.quoted:B$1)*{1,2}", original = book(expression);
  const array: Workbook = { ...original, sheets: original.sheets.map(sheet => ({ ...sheet,
    cells: [...sheet.cells.map(c => c.formula ? { ...c, formulaGroup: "array" } : c),
      { row: 7, column: 8, formulaGroup: "array", value: { kind: "number", value: 999 } }],
    formulaGroups: [{ id: "array", kind: "array", expression, range: { startRow: 7, endRow: 7, startColumn: 7, endColumn: 8 } }]
  })) };
  const reopened = await readOdf(await createOdfWriter("strict")(array, [], context), context);
  expect(reopened.sheets[0]!.formulaGroups?.[0]?.expression).toBe(expression);
  expect(value(reopened)).toEqual({ kind: "number", value: 9 });
  expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells.find(c => c.row === 7 && c.column === 8)?.value)
    .toEqual({ kind: "number", value: 18 });
});

it.each(["copy", "move"] as const)("exports after %s without changing the selected label", async translation => {
  const original = book(), sheet = original.sheets[0]!, source = sheet.cells.find(c => c.formula)!;
  const parsed = parseExpression(source.formula!, { workbook: original, position: { sheet: "stable", row: 7, column: 7 } });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  const formula = rewriteReferences(parsed.document, { translation, position: { sheet: "stable", row: 8, column: 7 } });
  const relocated = { ...original, sheets: [{ ...sheet, cells: sheet.cells.map(c => c === source ? { ...c, row: 8, formula } : c) }] };
  const reopened = await readOdf(await createOdfWriter("strict")(relocated, [], context), context);
  expect(reopened.sheets[0]!.cells.find(c => c.formula)?.formula).toBe(formula);
  expect(recalculateWorkbook(reopened, context, true).sheets[0]!.cells.find(c => c.formula)?.value).toEqual({ kind: "number", value: 9 });
});

it("writes a label-valued name as a named expression, not a cell range", async () => {
  const original = book("=SUM(Total)"), names = [{ name: "Total", expression: "=@column.odf.quoted:B$1", position: { sheet: "stable", row: 7, column: 7 } }];
  const named: Workbook = { ...original, names, sheets: original.sheets.map(sheet => ({ ...sheet,
    cells: [...sheet.cells, { row: 7, column: 1, value: { kind: "number", value: 13 } }],
    labelRanges: sheet.labelRanges!.map(pair => pair.axis === "column" ? { ...pair, data: { ...pair.data, endRow: 7 } } : pair)
  })) };
  expect(value(named)).toEqual({ kind: "number", value: 13 });
  const bytes = await createOdfWriter("strict")(named, [], context);
  expect((await unpackOdf(bytes)).parts.get("content.xml")).toContain('<table:named-expression table:name="Total" table:expression="of:=\'Sales\'"');
  const reopened = await readOdf(bytes, context);
  expect(reopened.names?.[0]?.expression).toContain("@column.odf.quoted:B$1");
  expect(reopened.names?.[0]?.position).toMatchObject({ row: 7, column: 7 });
  expect(value(reopened)).toEqual({ kind: "number", value: 13 });
});

it("preserves named-expression base coordinates on an apostrophe-containing sheet", async () => {
  const original = { ...book("=Target"), names: [{ name: "Target", expression: "=ROW()", position: { sheet: "stable", row: 7, column: 7 } }] };
  const reopened = await readOdf(await createOdfWriter("strict")(original, [], context), context);
  expect(reopened.names?.[0]?.position).toMatchObject({ sheet: "O'Brien", row: 7, column: 7 });
});

it("refuses quoted text that now resolves to a different declared anchor", async () => {
  const original = book(), sheet = original.sheets[0]!, pair = sheet.labelRanges![0]!;
  const ambiguous = { ...original, sheets: [{ ...sheet, cells: [
    { row: 0, column: 0, value: { kind: "string" as const, value: "Sales" } }, ...sheet.cells
  ], labelRanges: [{ ...pair, labels: { ...pair.labels, startColumn: 0 } }, ...sheet.labelRanges!.slice(1)] }] };
  await expect(createOdfWriter("strict")(ambiguous, [], context)).rejects.toMatchObject({ code: "unsupported-feature" });
});

it.each(["=SUM(@column.quoted:B$1)", "=SUM(@column.odf:B$1)", "=SUM(@column.value.odf.quoted:B$1)",
  "=SUM(@column.odf.quoted:$B$1)", "=#REF!!!#REF!", "=#REF!!!@row.odf.quoted:$A3"])(
  "refuses native label transport that loses identity or semantics: %s", async formula => {
    await expect(createOdfWriter("strict")(book(formula), [], context)).rejects.toMatchObject({ code: "unsupported-feature" });
  });

it.each(["blank", "number"] as const)("refuses a %s label cell without inventing native text", async kind => {
  const original = book(), sheet = original.sheets[0]!;
  const changed: Workbook = { ...original, sheets: [{ ...sheet, cells: sheet.cells.map(c => c.row === 0 ?
    { ...c, value: kind === "blank" ? { kind } : { kind, value: 42 } } : c) }] };
  await expect(createOdfWriter("strict")(changed, [], context)).rejects.toMatchObject({ code: "unsupported-feature" });
});

it("preserves mixed relative-sheet and live-label formulas", async () => {
  const original = book("of:=SUM('Sales')+[Other.B2]"), mixed: Workbook = { ...original,
    sheets: [...original.sheets, { id: "other", name: "Other", cells: [] }] };
  const reopened = await readOdf(await createOdfWriter("strict")(mixed, [], context), context);
  expect(value(reopened)).toEqual({ kind: "number", value: 9 });
});

it("exports a clean formula-generated label without discarding the captured anchor", async () => {
  const original = book(), sheet = original.sheets[0]!;
  const generated = { ...original, sheets: [{ ...sheet, cells: sheet.cells.map(c => c.row === 0 ? { ...c, formula: '="Sales"' } : c) }] };
  const reopened = await readOdf(await createOdfWriter("strict")(generated, [], context), context);
  expect(reopened.sheets[0]!.cells.find(c => c.row === 7)?.formula).toBe("=SUM(@column.odf.quoted:B$1)");
  expect(value(reopened)).toEqual({ kind: "number", value: 9 });
});
