import { expect, it } from "vitest";
import { parseExpression } from "./parser.js";
import { rewriteReferences } from "./rewriting.js";
import { excelGrammar, gnumericGrammar, odfGrammar, sylkGrammar } from "./conventions.js";

const workbook = { sheets: ["Local", "Remote", "Other"].map((name, i) => ({ id: `s${i}`, name, cells: [] })) };
const position = { sheet: "s0", row: 3, column: 2 };

it.each([["s0", "Local"], ["Local", "s0"], ["local", "LOCAL"]])("recognizes same-sheet aliases %s -> %s", (source, target) => {
  const parsed = parseExpression("=A1", { position: { ...position, sheet: source }, workbook, grammar: excelGrammar });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(rewriteReferences(parsed.document, { position: { sheet: target, row: 5, column: 4 }, translation: "move" })).toBe("=A1");
});

it.each(["=A1", "=Local!A1", "=Local!Rate"])("applies sheet-ID renames to %s", source => {
  const parsed = parseExpression(source, { position, workbook, grammar: excelGrammar });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  const expected = source.endsWith("Rate") ? "='Renamed'!Rate" : "='Renamed'!A1";
  expect(rewriteReferences(parsed.document, { position: { sheet: "Other", row: 5, column: 4 }, translation: "move", sheets: new Map([["s0", "Renamed"]]) })).toBe(expected);
});

it("keeps ID precedence for positions when another sheet has that display name", () => {
  const book = { sheets: [{ id: "s0", name: "Alpha", cells: [] }, { id: "s1", name: "s0", cells: [] }] };
  const parsed = parseExpression("=A1+s0!B2", { position, workbook: book, grammar: excelGrammar });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(rewriteReferences(parsed.document, { position: { ...position, sheet: "Alpha" }, translation: "move" })).toBe("=A1+s0!B2");
  expect(rewriteReferences(parsed.document, { position: { ...position, sheet: "s1" }, translation: "move" })).toBe("='Alpha'!A1+s0!B2");
});

it.each([
  { grammar: excelGrammar, source: "=Remote!A1+Remote!$B$2+[book.xlsx]Remote!C3" },
  { grammar: gnumericGrammar, source: "=Remote!A1+Remote!$B$2" },
  { grammar: odfGrammar, source: "of:=[Remote.A1:.B2]" },
  { grammar: gnumericGrammar, source: "=SUM(@range.multi:{Remote!$C$10;Remote!$A$1}->Remote!$A$2:$A$4)" }
])("preserves unchanged A1 source spelling in $grammar.id", ({ grammar, source }) => {
  const parsed = parseExpression(source, { position, workbook, grammar });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  for (const sheet of ["s0", "s2"]) {
    expect(rewriteReferences(parsed.document, { position: { sheet, row: 9, column: 4 }, translation: "move" })).toBe(source);
  }
});

it("still rewrites relative R1C1 offsets on moves", () => {
  const parsed = parseExpression("=Remote!R[-3]C[-2]+R1C1", { position, workbook, grammar: sylkGrammar });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(rewriteReferences(parsed.document, { position: { ...position, row: 5, column: 4 }, translation: "move" })).toBe("='Remote'!R[-5]C[-4]+R1C1");
});

it("preserves fixed spelling during copies while translating relative A1 axes", () => {
  const parsed = parseExpression("=Remote!$A$1+Remote!B2", { position, workbook, grammar: excelGrammar });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(rewriteReferences(parsed.document, { position: { ...position, row: 5, column: 4 }, translation: "copy" })).toBe("=Remote!$A$1+'Remote'!D4");
});

it("applies explicit endpoint edits even during A1 moves", () => {
  const parsed = parseExpression("=Remote!A1", { position, workbook, grammar: excelGrammar });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(rewriteReferences(parsed.document, { position: { ...position, row: 5, column: 4 }, translation: "move",
    endpoint: ref => ({ ...ref, column: { value: 6, relative: false } }) })).toBe("='Remote'!$G1");
});

it("prioritizes explicit display-name renames and excludes external names", () => {
  const parsed = parseExpression("=Local!A1+Local!Rate+[book.xlsx]Local!Rate", { position, workbook, grammar: excelGrammar });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(rewriteReferences(parsed.document, { sheets: new Map([["s0", "By ID"], ["Local", "By Name"]]) }))
    .toBe("='By Name'!A1+'By Name'!Rate+[book.xlsx]Local!Rate");
});

it("resolves display-name anchors and destinations for relative-sheet copies", () => {
  const parsed = parseExpression("of:=[Remote.A1]", { position: { ...position, sheet: "Local" }, workbook, grammar: odfGrammar });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(rewriteReferences(parsed.document, { position: { ...position, sheet: "local" }, translation: "copy" })).toBe(parsed.document.source);
  expect(rewriteReferences(parsed.document, { position: { ...position, sheet: "Remote" }, translation: "copy" })).toBe("of:=['Other'.A1]");
});

it("does not interpret a dangling sheet qualifier as a reference", () => {
  expect(parseExpression("=Remote!", { position, grammar: excelGrammar })).toMatchObject({ ok: false });
});
