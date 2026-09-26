import { expect, it } from "vitest";
import { parseExpression } from "./parser.js";
import { serializeExpression } from "./serialization.js";
import { gnumericGrammar, legacyApplixGrammar } from "./conventions.js";

const position = { sheet: 'First', row: 0, column: 0 };
it('derives native syntax rules from configuration rather than grammar names', () => {
  const grammar = { ...gnumericGrammar, id: 'custom-native' };
  expect(parseExpression('=#"custom"', { position, grammar })).toMatchObject({ ok: true, document: { root: { value: { kind: 'error', value: 'custom' } } } });
  expect(parseExpression("='literal'", { position, grammar })).toMatchObject({ ok: true });
  expect(parseExpression('=A0', { position, grammar })).toMatchObject({ ok: false });
});
it.each(['=First:A1..Last:B2', '=$First:$A1..$First:B$2', '=#NOT#TRUE#OR#FALSE', '=SUM(A1..B2,3)'])('parses source-defined Applix expression conventions: %s', source => {
  const result = parseExpression(source, { position, grammar: legacyApplixGrammar });
  expect(result).toMatchObject({ ok: true });
  if (result.ok) {
    const converted = serializeExpression(result.document, legacyApplixGrammar, false);
    expect(parseExpression(converted, { position, grammar: legacyApplixGrammar })).toMatchObject({ ok: true });
    expect(serializeExpression(result.document)).toBe(source);
  }
});
