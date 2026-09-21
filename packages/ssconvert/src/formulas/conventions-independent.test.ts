import { expect, it } from "vitest";
import { parseExpression } from "./parser.js";
import { serializeExpression } from "./serialization.js";
import { gnumericGrammar, sylkGrammar, sylkWriterGrammar } from "./conventions.js";

const position = { sheet: "s", row: 0, column: 0 };
it("uses the native backslash convention for SYLK reader formulas", () => {
  expect(parseExpression('="a\\nb"', { position, grammar: sylkGrammar })).toMatchObject({ ok: true, document: { root: { value: { kind: "string", value: "anb" } } } });
});

it("captures the native SYLK writer/reader backslash asymmetry", () => {
  const result = parseExpression('="a\\\\b"', { position, grammar: sylkGrammar });
  expect(result).toMatchObject({ ok: true, document: { root: { value: { kind: "string", value: "a\\b" } } } });
  if (!result.ok) throw new Error(result.diagnostic.message);
  const encoded = serializeExpression(result.document, sylkWriterGrammar, false);
  expect(encoded).toBe('="a\\b"');
  expect(parseExpression(encoded, { position, grammar: sylkGrammar })).toMatchObject({ ok: true, document: { root: { value: { kind: "string", value: "ab" } } } });
});

it("captures embedded-quote SYLK writer output that its native reader cannot parse", () => {
  const result = parseExpression('="a\\"b"', { position, grammar: sylkGrammar });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.diagnostic.message);
  const encoded = serializeExpression(result.document, sylkWriterGrammar, false);
  expect(encoded).toBe('="a"b"');
  expect(parseExpression(encoded, { position, grammar: sylkGrammar })).toMatchObject({ ok: false });
});

it("converts quoted array values using native simple scalar matching", () => {
  const result = parseExpression('={"1","TRUE","#REF!","x";"  -1.2E+2\\t","false","#ref!"," TRUE "}', { position, grammar: gnumericGrammar });
  expect(result).toMatchObject({ ok: true, document: { root: { kind: "array", rows: [
    [{ value: { kind: "number", value: 1 } }, { value: { kind: "boolean", value: true } }, { value: { kind: "error", value: "#REF!" } }, { value: { kind: "string", value: "x" } }],
    [{ value: { kind: "string", value: "  -1.2E+2t" } }, { value: { kind: "boolean", value: false } }, { value: { kind: "string", value: "#ref!" } }, { value: { kind: "string", value: " TRUE " } }]
  ] } } });
  expect(parseExpression('="1"', { position, grammar: gnumericGrammar })).toMatchObject({ ok: true, document: { root: { value: { kind: "string", value: "1" } } } });
});

it.each([["  -1.2E+2\t", -120], [".25", .25], ["+2.", 2]])("matches decimal array strings %s", (text, value) => {
  const result = parseExpression('={"' + text + '"}', { position, grammar: gnumericGrammar });
  expect(result).toMatchObject({ ok: true, document: { root: { rows: [[{ value: { kind: "number", value } }]] } } });
  if (result.ok) expect(parseExpression(serializeExpression(result.document, gnumericGrammar, false), { position, grammar: gnumericGrammar })).toMatchObject({ ok: true });
});
