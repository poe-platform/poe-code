import { expect, it } from "vitest";
import { parseExpression } from "./parser.js";
import { serializeExpression } from "./serialization.js";
import { excelGrammar, gnumericGrammar, legacyApplixGrammar, sylkGrammar } from "./conventions.js";

const position = { sheet: "First", row: 2, column: 3 };
it("retains syntactically valid negative relative R1C1 offsets at the origin", () => {
  const result = parseExpression("=R[-1]C", { position: { ...position, row: 0, column: 0 }, grammar: sylkGrammar });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.diagnostic.message);
  expect(serializeExpression(result.document, sylkGrammar, false)).toBe("=R[-1]C");
});
it("uses GOffice backslash unescaping rather than C escape semantics", () => {
  expect(parseExpression('="a\\nb\\tc\\r"', { position, grammar: gnumericGrammar })).toMatchObject({ ok: true, document: { root: { value: { kind: "string", value: "anbtcr" } } } });
  const source = '="a\nb\tc\r"';
  const result = parseExpression(source, { position, grammar: gnumericGrammar });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.diagnostic.message);
  expect(serializeExpression(result.document, gnumericGrammar, false)).toBe(source);
});
it.each([gnumericGrammar, excelGrammar])("retains external workbook-only names without local namespace callbacks: $id", grammar => {
  for (const source of ["=[book]LocalName", "=[book]!LocalName", "=['book file']LocalName"]) {
    const callbacks: string[] = [];
    const result = parseExpression(source, { position, grammar, onName: name => callbacks.push(name) });
    expect(result).toMatchObject({ ok: true, document: { root: { kind: "name", name: "LocalName", workbook: source.includes("file") ? "book file" : "book" } } });
    if (!result.ok) throw new Error(result.diagnostic.message);
    expect(serializeExpression(result.document)).toBe(source);
    expect(parseExpression(serializeExpression(result.document, grammar, false), { position, grammar })).toMatchObject({ ok: true, document: { root: { kind: "name", name: "LocalName" } } });
    expect(callbacks).toEqual([]);
  }
});
it.each(["=#not#TRUE", "=TRUE#and#FALSE", "=TRUE#or#FALSE", "=A1 B2", "=1..2", "=A1..", "=..A1", "=A1...B2", "=Bad_Name:A1", "=名:A1", "='Bad Name':A1", "=First:Local"])("rejects unsupported Applix syntax: %s", source => {
  expect(parseExpression(source, { position, grammar: legacyApplixGrammar })).toMatchObject({ ok: false });
});

it("retains a qualified last endpoint after an unqualified initial cell", () => {
  expect(parseExpression("=A1..Last:B2", { position, grammar: legacyApplixGrammar })).toMatchObject({ ok: true, document: { root: { kind: "reference", first: { row: { value: -2 } }, last: { sheet: "Last" } } } });
});

it("refuses errors and qualified names that the destination grammar cannot represent", () => {
  for (const [source, grammar] of [["=#\"marker\"", { ...gnumericGrammar, quotedErrors: false }], ["=First!Local", legacyApplixGrammar]] as const) {
    const result = parseExpression(source, { position, grammar: gnumericGrammar });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.diagnostic.message);
    expect(() => serializeExpression(result.document, grammar, false)).toThrow("Unsupported ssconvert feature");
  }
});

it.each(["=SUM(A1..B2,1.5)", "=#NOT#(TRUE#AND#FALSE)#OR#TRUE", "=$First:$A1..$Last:B$2", "={1,2;3,4}"])("reparses valid Applix syntax: %s", source => {
  const result = parseExpression(source, { position, grammar: legacyApplixGrammar });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.diagnostic.message);
  expect(parseExpression(serializeExpression(result.document, legacyApplixGrammar, false), { position, grammar: legacyApplixGrammar }).ok).toBe(true);
});

it.each([["iPaYmT", "IPMT"], ["PAYMT", "PMT"], ["ppaymt", "PPMT"]])("maps source-defined Applix function alias %s", (spelling, name) => {
  const result = parseExpression(`=${spelling}(1,2,3)`, { position, grammar: legacyApplixGrammar });
  expect(result).toMatchObject({ ok: true, document: { root: { kind: "call", name, spelling } } });
  if (result.ok) expect(serializeExpression(result.document, gnumericGrammar, false)).toBe(`=${name}(1,2,3)`);
});

it("refuses conversion when the target grammar disables intersection instead of joining tokens", () => {
  const result = parseExpression("=A1 B2", { position, grammar: gnumericGrammar });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.diagnostic.message);
  expect(() => serializeExpression(result.document, legacyApplixGrammar, false)).toThrow("intersection");
});
