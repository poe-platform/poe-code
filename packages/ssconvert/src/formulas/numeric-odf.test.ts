import { expect, it } from "vitest";
import { parseExpression } from "./parser.js";
import { gnumericGrammar, odfGrammar } from "./conventions.js";
import { serializeExpression } from "./serialization.js";
import { rewriteReferences } from "./rewriting.js";

const position = { sheet: "Sheet", row: 0, column: 0 };
it("rewrites each lexical reference once after OpenFormula rounding expansion", () => {
  const source = 'of:=FLOOR([Remote.A1];[Remote.B1];[Remote.C1])';
  const parsed = parseExpression(source, { position, grammar: odfGrammar });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  let visits = 0;
  expect(rewriteReferences(parsed.document, { sheets: new Map([["Remote", "Actual"]]), endpoint(reference) { visits++; return reference; } })).toBe("of:=FLOOR(['Actual'.A1];['Actual'.B1];['Actual'.C1])");
  expect(visits).toBe(3);
});
it.each([
  ["=CEIL(2.5)", "of:=CEILING(2.5)"],
  ["=FLT.NEXTAFTER(1,2)", "of:=ORG.GNUMERIC.FLT.NEXTAFTER(1;2)"],
  ["=ODF.SUMPRODUCT({1,2},{3,4})", "of:=SUMPRODUCT({1;2};{3;4})"],
  ["=FLOOR(-2.5)", "of:=floor(-2.5;SIGN(-2.5);1)"],
  ["=CEILING(-2.5,-1)", "of:=ceiling(-2.5;-1;1)"],
  ["=FLOOR()", "of:=floor(floor()"],
  ["=CEILING()", "of:=ceiling(ceiling()"],
  ["=SUMPRODUCT({1,2},{3,4})", "of:=ORG.GNUMERIC.SUMPRODUCT({1;2};{3;4})"]
])("exports numeric OpenFormula names and native rounding mode: %s", (source, expected) => {
  const parsed = parseExpression(source, { position });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(serializeExpression(parsed.document, odfGrammar, false, true)).toBe(expected);
});

it.each([
  ["of:=SUMPRODUCT({1;2};{3;4})", "=odf.sumproduct({1,2},{3,4})"],
  ["of:=ORG.GNUMERIC.SUMPRODUCT({1;2};{3;4})", "=sumproduct({1,2},{3,4})"],
  ["of:=CEILING(-2.5)", "=ceil(-2.5)"],
  ["of:=FLOOR(-2.5;-1;1)", "=floor(-2.5,-1)"],
  ["of:=CEILING(-2.5;-1;1)", "=ceiling(-2.5,-1)"],
  ["of:=FLOOR(-2.5;-1;0)", "=IF(-2.5<0,ceiling(-2.5,-1),floor(-2.5,-1))"],
  ["of:=CEILING(-2.5;-1)", "=IF(-2.5<0,floor(-2.5,-1),ceiling(-2.5,-1))"],
  ["of:=FLOOR([.A1];1;[.B1])", "=IF(0=B1,IF(A1<0,ceiling(A1,1),floor(A1,1)),floor(A1,1))"],
  ["of:=ORG.GNUMERIC.FLOOR(-2.5;-1)", "=floor(-2.5,-1)"],
  ["of:=FLOOR()", "=ODF.FLOOR()"],
  ["of:=CEILING()", "=ODF.CEILING()"],
  ["of:=FLOOR(1;1;0;1)", "=ODF.FLOOR(1,1,0,1)"],
  ["of:=CEILING(1;1;0;1)", "=ODF.CEILING(1,1,0,1)"]
])("imports numeric namespace and rounding argument semantics: %s", (source, expected) => {
  const parsed = parseExpression(source, { position, grammar: odfGrammar });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(serializeExpression(parsed.document)).toBe(source);
  expect(serializeExpression(parsed.document, gnumericGrammar, false, true)).toBe(expected);
});
