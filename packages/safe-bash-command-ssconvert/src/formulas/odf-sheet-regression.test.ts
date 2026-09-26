import { expect, it } from "vitest";
import { parseExpression } from "./parser.js";
import { excelGrammar, odfGrammar } from "./conventions.js";
import { rewriteReferences } from "./rewriting.js";
import { serializeExpression } from "./serialization.js";

const position = { sheet: "Local", row: 3, column: 2 };

it.each(["of:=[$Remote.$A1]", "of:=[$'Remote'.$A1]"])("ignores ODF absolute sheet sigils as Gnumeric does: %s", source => {
  const parsed = parseExpression(source, { position, grammar: odfGrammar });
  expect(parsed).toMatchObject({ ok: true, document: { root: { kind: "reference", first: { sheet: "Remote", column: { value: 0, relative: false } } } } });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(rewriteReferences(parsed.document, { sheets: new Map([["Remote", "O'Brien"]]) })).toBe("of:=['O''Brien'.$A1]");
});

it("allows punctuation in unquoted ODF sheet names rather than treating it as an operator", () => {
  const source = "of:=[Budget-2026.A1:Budget-2026.B2]";
  expect(parseExpression(source, { position, grammar: odfGrammar })).toMatchObject({ ok: true, document: { root: {
    kind: "reference", first: { sheet: "Budget-2026" }, last: { sheet: "Budget-2026" }
  } } });
});

it("resolves a missing last-endpoint sheet against the first sheet as Gnumeric does", () => {
  const parsed = parseExpression("of:=[Remote.A1:.B2]", { position, grammar: odfGrammar });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(parsed.document.root).toMatchObject({ kind: "reference", first: { sheet: "Remote" }, last: { row: { value: -2 } } });
  if (parsed.document.root.kind !== "reference") throw new Error("Expected reference");
  // position.c:717 and expr.c:3573: a NULL b sheet means a's sheet.
  expect(parsed.document.root.last?.sheet).toBe("Remote");
  expect(serializeExpression(parsed.document, excelGrammar, false)).toBe("='Remote'!A1:B2");
  expect(rewriteReferences(parsed.document, { sheets: new Map([["Remote", "Renamed"]]) })).toBe("of:=['Renamed'.A1:'Renamed'.B2]");
});

it.each(["of:=[$'Remote'.A1", "of:=['Remote'x.A1]", "of:=[Budget-2026.A1:]"])("rejects malformed ODF qualifiers: %s", source => {
  expect(parseExpression(source, { position, grammar: odfGrammar })).toMatchObject({ ok: false, source });
});
