import { expect, it } from "vitest";
import { gnumericGrammar } from "./conventions.js";
import { parseExpression } from "./parser.js";
import { serializeExpression } from "./serialization.js";

it.each([
  ["=sInPi(0.25)", "=sinpi(0.25)"],
  ["=BESSELK(2,0)", "=besselk(2,0)"],
  ["=IMARGUMENT(1)", "=imargument(1)"],
  ["=FLT.NEXTAFTER(1,2)", "=flt.nextafter(1,2)"],
  ["=G_PRODUCT(2,3)", "=g_product(2,3)"],
  ["=NT_PHI(36)", "=nt_phi(36)"],
  ["=UnregisteredNumeric(2)", "=UNREGISTEREDNUMERIC(2)"]
])("writes registered numeric native names canonically: %s", (source, expected) => {
  const parsed = parseExpression(source, { position: { sheet: "s", row: 0, column: 0 } });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(serializeExpression(parsed.document)).toBe(source);
  expect(serializeExpression(parsed.document, gnumericGrammar, false, true)).toBe(expected);
});
