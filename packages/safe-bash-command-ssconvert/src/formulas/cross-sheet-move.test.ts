import { expect, it } from "vitest";
import { parseExpression } from "./parser.js";
import { rewriteReferences } from "./rewriting.js";
import { excelGrammar, gnumericGrammar, odfGrammar, sylkGrammar } from "./conventions.js";

const position = { sheet: "Local", row: 3, column: 2 };

// Calc token.cxx:AdjustReferenceOnMovedOrigin resolves at the old position
// before rebasing at the new one, including the sheet coordinate.
it.each([
  { grammar: gnumericGrammar, source: "=A1:$B$2", expected: "='Local'!A1:$B$2" },
  { grammar: excelGrammar, source: "=A1:$B$2", expected: "='Local'!A1:$B$2" },
  { grammar: odfGrammar, source: "of:=[.A1:.$B$2]", expected: "of:=[$'Local'.A1:.$B$2]" },
  { grammar: sylkGrammar, source: "=R[-3]C[-2]:R2C2", expected: "='Local'!R[-3]C[-2]:R2C2" }
])("retains implicit targets when moving across sheets in $grammar.id", ({ grammar, source, expected }) => {
  const parsed = parseExpression(source, { position, grammar });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(rewriteReferences(parsed.document, { position: { ...position, sheet: "Other" }, translation: "move" })).toBe(expected);
  expect(rewriteReferences(parsed.document, { position: { ...position, sheet: "Other" }, translation: "copy" })).toBe(source);
  expect(rewriteReferences(parsed.document, { position, translation: "move" })).toBe(source);
});

it("uses the source sheet's captured display name and applies a simultaneous rename", () => {
  const workbook = { sheets: [{ id: "s", name: "O'Brien", cells: [] }, { id: "t", name: "Target", cells: [] }] };
  const parsed = parseExpression("=A1", { position: { ...position, sheet: "s" }, grammar: excelGrammar, workbook });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  workbook.sheets[0]!.name = "Mutated";
  const move = { position: { sheet: "t", row: 8, column: 5 }, translation: "move" as const };
  expect(rewriteReferences(parsed.document, move)).toBe("='O''Brien'!A1");
  expect(rewriteReferences(parsed.document, { ...move, sheets: new Map([["O'Brien", "Renamed"]]) })).toBe("='Renamed'!A1");
});

it("qualifies the implicit end of a mixed-sheet ODF range independently", () => {
  const parsed = parseExpression("of:=[.A1:Remote.B2]", { position, grammar: odfGrammar });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  const destination = { ...position, sheet: "Other" };
  const moved = rewriteReferences(parsed.document, { position: destination, translation: "move" });
  expect(moved).toBe("of:=[$'Local'.A1:'Remote'.B2]");
  const reparsed = parseExpression(moved, { position: destination, grammar: odfGrammar });
  if (!reparsed.ok) throw new Error(reparsed.diagnostic.message);
  expect(reparsed.document.root).toMatchObject({ kind: "reference",
    first: { sheet: "Local", sheetRelative: false }, last: { sheet: "Remote", sheetRelative: true } });
});

it("preserves external targets and source strings during cross-sheet moves", () => {
  const parsed = parseExpression('=F(A1,[book.xlsx]Remote!B2,"A1")', { position, grammar: excelGrammar });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(rewriteReferences(parsed.document, { position: { sheet: "Other", row: 9, column: 4 }, translation: "move" }))
    .toBe('=F(\'Local\'!A1,[book.xlsx]Remote!B2,"A1")');
});
