import { expect, it } from "vitest";
import { parseExpression } from "./parser.js";
import { excelGrammar, gnumericGrammar, odfGrammar, sylkGrammar } from "./conventions.js";
import { serializeExpression } from "./serialization.js";
import { rewriteReferences } from "./rewriting.js";
import type { FormulaGrammar, FormulaNode } from "./ast.js";

const position = { sheet: "Local", row: 4, column: 2 };
function parse(source: string, grammar: FormulaGrammar = excelGrammar) {
  const result = parseExpression(source, { grammar, position });
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(result.diagnostic.message);
  return result.document;
}

it("lowers native Unicode logical operations with source precedence", () => {
  expect(parse("=¬TRUE∧FALSE∨TRUE", gnumericGrammar).root).toMatchObject({ kind: "call", name: "NOT", args: [
    { kind: "call", name: "OR", args: [{ kind: "call", name: "AND", args: [{ kind: "literal" }, { kind: "literal" }] }, { kind: "literal" }] }
  ] });
  const original = parse("=TRUE∧FALSE", gnumericGrammar);
  expect(serializeExpression(original)).toBe("=TRUE∧FALSE");
  expect(serializeExpression(original, excelGrammar, false)).toBe("=AND(TRUE,FALSE)");
  expect(parse("=TRUE∧(A1,B1)", gnumericGrammar).root).toMatchObject({ kind: "call", name: "AND", args: [{ kind: "literal" }, { kind: "parentheses", child: { kind: "binary", op: "union" } }] });
  expect(parse("=RC", gnumericGrammar).root).toMatchObject({ kind: "name", name: "RC" });
});

it.each(["=R1", "=C1", "=R[-1]", "=C[2]"])("accepts R1C1 singleton whole axes: %s", source => {
  const document = parse(source, sylkGrammar);
  expect(document.root.kind).toBe("reference");
  expect(parse(serializeExpression(document, excelGrammar, false)).root.kind).toBe("reference");
});

it("rejects a reserved R1C1-style native name and native doubled string quotes", () => {
  expect(parseExpression("=R1C1", { position, grammar: gnumericGrammar })).toMatchObject({ ok: false });
  expect(parseExpression('="a""b"', { position, grammar: gnumericGrammar })).toMatchObject({ ok: false });
  expect(parseExpression("=#NOT#TRUE", { position, grammar: gnumericGrammar })).toMatchObject({ ok: false });
  expect(parseExpression("=TRUE#AND#FALSE", { position, grammar: gnumericGrammar })).toMatchObject({ ok: false });
});

it("accepts native single-quoted strings and quoted custom errors without confusing sheet qualifiers", () => {
  expect(parse("='a\\'b'", gnumericGrammar).root).toMatchObject({ kind: "literal", value: { kind: "string", value: "a'b" } });
  const error = parse('=#"custom error"', gnumericGrammar);
  expect(error.root).toMatchObject({ kind: "literal", value: { kind: "error", value: "custom error" } });
  expect(serializeExpression(error, gnumericGrammar, false)).toBe('=#"custom error"');
  expect(parse("='Remote'!A1", gnumericGrammar).root.kind).toBe("reference");
});

it.each(["=😀", "=Name©", "=²Name"])("rejects native nonalphabetic names: %s", source => {
  expect(parseExpression(source, { position, grammar: gnumericGrammar })).toMatchObject({ ok: false });
});

it.each(["=Δείγμα", "=名", "=𝒜_name"])("accepts native Unicode alphabetic names: %s", source => {
  expect(parse(source, gnumericGrammar).root.kind).toBe("name");
});

it("keeps external targets fixed when moving their formula", () => {
  const document = parse("=[other.xlsx]Remote!A1+$B2");
  const moved = rewriteReferences(document, { translation: "move", position: { ...position, row: 5, column: 3 } });
  expect(parseExpression(moved, { grammar: excelGrammar, position: { ...position, row: 5, column: 3 } })).toMatchObject({
    ok: true, document: { root: { left: { first: { row: { value: -5 }, column: { value: -3 }, workbook: "other.xlsx" } } } }
  });
});

it("retains an explicitly qualified last endpoint in a range", () => {
  const document = parse("of:=[.A1:Remote.B2]", odfGrammar);
  const converted = parse(serializeExpression(document, excelGrammar, false));
  expect(converted.root).toMatchObject({ kind: "reference", first: { sheet: "Local", row: { value: -4 } }, last: { sheet: "Remote", row: { value: -3 } } });
});

it("uses workbook display names rather than stable sheet IDs when qualifying a local range", () => {
  const workbook = { sheets: [{ id: "s", name: "First", cells: [] }, { id: "r", name: "Remote", cells: [] }] };
  const result = parseExpression("of:=[.A1:Remote.B2]", { grammar: odfGrammar, position: { ...position, sheet: "s" }, workbook });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.diagnostic.message);
  workbook.sheets[0]!.name = "Mutated";
  expect(serializeExpression(result.document, excelGrammar, false)).toBe("='First':'Remote'!A1:B2");
});

it("retains external named-expression namespaces in ODF", () => {
  const document = parse("of:=['file:///other.ods'#Remote.LocalName]", odfGrammar);
  expect(document.root).toMatchObject({ kind: "name", name: "LocalName", workbook: "file:///other.ods", sheet: "Remote" });
  const converted = parse(serializeExpression(document, odfGrammar, false), odfGrammar);
  expect(converted.root).toMatchObject({ kind: "name", name: "LocalName", workbook: "file:///other.ods", sheet: "Remote" });
});

it("keeps bracket syntax when renaming an ODF sheet-scoped name", () => {
  const source = "of:=[Remote.LocalName]";
  const renamed = rewriteReferences(parse(source, odfGrammar), { sheets: new Map([["Remote", "New Remote"]]) });
  expect(renamed).toBe("of:=['New Remote'.LocalName]");
  expect(parse(renamed, odfGrammar).root).toMatchObject({ kind: "name", name: "LocalName", sheet: "New Remote" });
});

it.each([
  '=F(,,,)', '=F("a""b",,TRUE,#DIV/0!)', '=-(2^3)%+4&"z"',
  '={-1,+2,3.4E-2;TRUE,FALSE,#N/A}', '=SUM((A1,B2) C3)',
  "='O''Brien'!$A1:B$2", '=[external.xlsx]Remote!$A1:B$2',
  '=2^3^2', '=A1<>B2', '=INDEX(A1:B2,1):B5'
])("reparses converted Excel and ODF trees: %s", source => {
  const original = parse(source);
  const odf = parse(serializeExpression(original, odfGrammar, false), odfGrammar);
  const roundTrip = parse(serializeExpression(odf, excelGrammar, false));
  function structural(value: FormulaNode): unknown {
    if (value.kind === "parentheses") return structural(value.child);
    if (value.kind === "unary") return { kind: value.kind, op: value.op, child: structural(value.child) };
    if (value.kind === "binary") return { kind: value.kind, op: value.op, left: structural(value.left), right: structural(value.right) };
    if (value.kind === "call") return { kind: value.kind, name: value.name, args: value.args.map(structural) };
    if (value.kind === "array") return { kind: value.kind, rows: value.rows.map(row => row.map(structural)) };
    if (value.kind === "literal") return { kind: value.kind, value: value.value };
    if (value.kind === "reference") return { kind: value.kind, first: value.first, last: value.last };
    if (value.kind === "name") return { kind: value.kind, name: value.name, sheet: value.sheet, workbook: value.workbook };
    return { kind: value.kind };
  }
  expect(structural(roundTrip.root)).toEqual(structural(original.root));
});
