import { expect, it } from "vitest";
import { createOdfWriter, readOdf } from "./odf.js";
import { context, unpackOdf } from "./odf-write.test.js";
import { parseExpression } from "../formulas/parser.js";
import { serializeExpression } from "../formulas/serialization.js";
import { rewriteReferences, visitFormula } from "../formulas/rewriting.js";
import { gnumericGrammar, odfGrammar } from "../formulas/conventions.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import type { Workbook } from "../workbook.js";
import type { FormulaDocument, FormulaNode } from "../formulas/ast.js";

const position = { sheet: "s", row: 3, column: 7 };
function book(formula: string): Workbook {
  return { automaticLabelLookup: false, sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 1, value: { kind: "string", value: "Sales" } },
    ...[2, 7, 11, 13, 17].map((value, index) => ({ row: index + 1, column: 1, value: { kind: "number" as const, value } })),
    { row: position.row, column: position.column, formula, formulaDirty: true, value: { kind: "number", value: 999 } }
  ], labelRanges: [{ axis: "column", labels: { startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 },
    data: { startRow: 1, endRow: 5, startColumn: 1, endColumn: 1 } }] },
  { id: "other", name: "Other", cells: [{ row: 1, column: 1, value: { kind: "number", value: 20 } }] },
  { id: "third", name: "Third", cells: [{ row: 1, column: 1, value: { kind: "number", value: 30 } }] }] };
}
function parse(source: string, workbook = book(source), native = false): FormulaDocument {
  const parsed = parseExpression(source, { position, workbook, ...(native ? { grammar: odfGrammar } : {}) });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  return parsed.document;
}
function labels(document: FormulaDocument) {
  const nodes: FormulaNode[] = [];
  visitFormula(document.root, node => { if (node.kind === "reference" && node.label) nodes.push(node); });
  return nodes.map(node => { const { start: ignoredStart, end: ignoredEnd, ...value } = node; return value; });
}
function result(workbook: Workbook) {
  return recalculateWorkbook(workbook, context, true).sheets[0]!.cells.find(cell => cell.formula)!.value;
}

it.each([["of:=SUM('Sales':[.B5])", 24], ["of:=SUM(('Sales'):[.B5])", 50]] as const)(
  "preserves range-label grouping and fresh value for %s", (source, expected) => {
    const input = parse(source, book(source), true);
    const internal = serializeExpression(input, gnumericGrammar, false, true);
    const reopened = parse(internal);
    expect(labels(reopened)).toEqual(labels(input));
    expect(result(book(internal))).toEqual({ kind: "number", value: expected });
  });

it.each(["=@row:A1:B2", "=SUM(@column.odf.quoted:B$1:B5)"])("parses an outer range after a single label anchor: %s", source => {
  const document = parse(source);
  const range = document.root.kind === "call" ? document.root.args[0]! : document.root;
  expect(range).toMatchObject({ kind: "binary", op: ":", left: { kind: "reference", label: { scalar: true } } });
});

it.each(["strict", "extended"] as const)("roundtrips %s mixed relative-sheet and live-label expressions", async profile => {
  const source = "of:=SUM('Sales':[.B5])+[Other.B2]", input = book(source);
  const bytes = await createOdfWriter(profile)(input, [], context);
  const xml = (await unpackOdf(bytes)).parts.get("content.xml")!;
  expect(xml).toContain("of:=SUM('Sales':[.B5])+['Other'.B2]");
  expect(xml).not.toContain("@column");
  const reopened = await readOdf(bytes, context);
  expect(result(reopened)).toEqual({ kind: "number", value: 44 });
  const cell = reopened.sheets[0]!.cells.find(cell => cell.formula)!;
  const document = parseExpression(cell.formula!, { workbook: reopened, position: { ...position, sheet: reopened.sheets[0]!.id } });
  if (!document.ok) throw new Error(document.diagnostic.message);
  const anchor = labels(document.document)[0];
  expect(anchor).toMatchObject({ first: { row: { value: 0, relative: false } } });
  if (anchor?.kind !== "reference") throw new Error("Expected label reference");
  expect(anchor.first.sheetRelative).toBeUndefined();
  expect(anchor.first.sheetOffset).toBeUndefined();
  const renamed: Workbook = { ...reopened, sheets: reopened.sheets.map((sheet, i) => i === 0 ? { ...sheet,
    cells: sheet.cells.map(c => c.row === 0 && c.column === 1 ? { ...c, value: { kind: "string", value: "New Sales" } } : c)
  } : sheet) };
  const renamedBytes = await createOdfWriter(profile)(renamed, [], context);
  expect((await unpackOdf(renamedBytes)).parts.get("content.xml")).toContain("SUM('New Sales':[.B5])");
  expect(result(await readOdf(renamedBytes, context))).toEqual({ kind: "number", value: 44 });
});

it("keeps native OpenFormula strict about internal anchors and deleted intersections", () => {
  for (const source of ["of:=@column.odf.quoted:[.B$1]", "of:=#REF!!!#REF!"])
    expect(parseExpression(source, { position, workbook: book(source), grammar: odfGrammar }).ok).toBe(false);
});

it("keeps bracketed ranges invalid as a single label anchor", () => {
  for (const source of ["of:=@column.odf.quoted:[.B$1:.B5]", "of:=@range.multi:{[.B1:.B2]}->[.B3:.B5]"])
    expect(parseExpression(source, { position, workbook: book(source) }).ok).toBe(false);
});

it("preserves local label identity while ordinary named sheets remain relative after a move and copy", () => {
  const source = "of:=SUM(@column.odf.quoted:[.B$1])+[Other.B2]";
  const original = parse(source);
  const movedSource = rewriteReferences(original, { translation: "move", position: { ...position, sheet: "other" } });
  const moved = parseExpression(movedSource, { position: { ...position, sheet: "other" }, workbook: book(source) });
  if (!moved.ok) throw new Error(moved.diagnostic.message);
  const copiedSource = rewriteReferences(moved.document, { translation: "copy", position: { ...position, sheet: "third" } });
  const copied = parseExpression(copiedSource, { position: { ...position, sheet: "third" }, workbook: book(source) });
  if (!copied.ok) throw new Error(copied.diagnostic.message);
  expect(labels(copied.document)).toMatchObject([{ first: { sheet: "S", sheetRelative: false } }]);
  const ordinary: FormulaNode[] = [];
  visitFormula(copied.document.root, node => { if (node.kind === "reference" && !node.label) ordinary.push(node); });
  expect(ordinary).toMatchObject([{ first: { sheet: "Third", sheetRelative: true, sheetOffset: 0 } }]);
});

it.each(["strict", "extended"] as const)("preserves a %s mixed named expression at its base position", async profile => {
  const source = "of:=SUM('Sales':[.B5])+[Other.B2]";
  const original = { ...book("=Total"), names: [{ name: "Total", expression: source, position }] };
  expect(result(original)).toEqual({ kind: "number", value: 44 });
  const bytes = await createOdfWriter(profile)(original, [], context);
  const xml = (await unpackOdf(bytes)).parts.get("content.xml")!;
  expect(xml).toContain('table:expression="of:=SUM(\'Sales\':[.B5])+[\'Other\'.B2]"');
  const reopened = await readOdf(bytes, context);
  expect(reopened.names?.[0]?.expression).toContain("@column.odf.quoted:");
  expect(result(reopened)).toEqual({ kind: "number", value: 44 });
});

it.each(["strict", "extended"] as const)("preserves a %s mixed array formula and its second result", async profile => {
  const expression = "of:=SUM('Sales':[.B5])*{1;2}+[Other.B2]", original = book(expression);
  const array: Workbook = { ...original, sheets: original.sheets.map((sheet, index) => index !== 0 ? sheet : { ...sheet,
    cells: [...sheet.cells.map(cell => cell.formula ? { ...cell, formulaGroup: "array" } : cell),
      { row: position.row, column: position.column + 1, formulaGroup: "array", value: { kind: "number", value: 999 } }],
    formulaGroups: [{ id: "array", kind: "array", expression,
      range: { startRow: position.row, endRow: position.row, startColumn: position.column, endColumn: position.column + 1 } }]
  }) };
  const reopened = await readOdf(await createOdfWriter(profile)(array, [], context), context);
  const calculated = recalculateWorkbook(reopened, context, true);
  expect(calculated.sheets[0]!.cells.filter(cell => cell.row === position.row && cell.column >= position.column).map(cell => cell.value))
    .toEqual([{ kind: "number", value: 44 }, { kind: "number", value: 68 }]);
  expect(reopened.sheets[0]!.formulaGroups?.[0]?.expression).toContain("@column.odf.quoted:");
});

it.each(["strict", "extended"] as const)("keeps a %s remote label fixed beside ordinary relative-sheet references", async profile => {
  const formula = "of:=SUM('Sales':[S.B5])+[Other.B2]", original = book(formula);
  const remote: Workbook = { ...original, sheets: [{ id: "output", name: "Output", cells: [
    { row: position.row, column: position.column, formula, formulaDirty: true, value: { kind: "number", value: 999 } }
  ] }, { ...original.sheets[0]!, cells: original.sheets[0]!.cells.filter(cell => !cell.formula) }, original.sheets[1]!] };
  const bytes = await createOdfWriter(profile)(remote, [], context);
  const reopened = await readOdf(bytes, context);
  expect(result(reopened)).toEqual({ kind: "number", value: 44 });
  const cell = reopened.sheets[0]!.cells.find(cell => cell.formula)!;
  const parsed = parseExpression(cell.formula!, { position: { ...position, sheet: reopened.sheets[0]!.id }, workbook: reopened });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(labels(parsed.document)).toMatchObject([{ first: { sheet: "S", sheetRelative: false } }]);
});

it.each(["of:=#REF!!!#REF!", "of:=#REF!!!@row.odf.quoted:[.$A3]",
  "of:=@column.odf.quoted:[.B$1]!!#REF!"])("preserves an internal deleted label intersection: %s", source => {
  const parsed = parse(source);
  expect(parsed.root).toMatchObject({ kind: "binary", op: "label-intersection" });
  const reopened = parse(serializeExpression(parsed, undefined, false, true));
  expect(reopened.root).toMatchObject({ kind: "binary", op: "label-intersection" });
  expect(labels(reopened)).toEqual(labels(parsed));
});

it("keeps radical members single-cell while preserving their explicit data range", () => {
  const source = "of:=SUM(@range.multi:{[.B1];[.C1]}->[.B2:.C5])";
  const parsed = parse(source), reopened = parse(serializeExpression(parsed, undefined, false, true));
  expect(labels(reopened)).toEqual(labels(parsed));
  for (const invalid of ["=@range.multi:{A1:B2}->C1:C5", "=@range:A1:B2->C1:C5"])
    expect(parseExpression(invalid, { position }).ok).toBe(false);
});
