import { expect, it } from "vitest";
import { parseExpression } from "./parser.js";
import { excelGrammar, gnumericGrammar } from "./conventions.js";
import { serializeExpression } from "./serialization.js";
const position = { sheet: "Sheet", row: 0, column: 0 };

it.each([
  ["=NT_PHI(36)", "=_xlfngnumeric.NT_PHI(36)"],
  ["=FLT.NEXTAFTER(1,2)", "=_xlfngnumeric.FLT.NEXTAFTER(1,2)"],
  ["=SINPI(0.25)", "=_xlfngnumeric.SINPI(0.25)"],
  ["=ERF(1)", "=_xlfn.ERF.PRECISE(1)"],
  ["=ERF(1,2)", "=ERF(1,2)"],
  ["=ERFC(1)", "=_xlfn.ERFC.PRECISE(1)"],
  ["=GAMMALN(2)", "=_xlfn.GAMMALN.PRECISE(2)"],
  ["=FLOOR(-2.5)", "=ROUNDDOWN(-2.5,0)"],
  ["=FLOOR(-2.5,-1)", "=FLOOR(-2.5,-1)"]
])("exports released XLSX numeric names and handlers: %s", (source, expected) => {
  const parsed = parseExpression(source, { position });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(serializeExpression(parsed.document, excelGrammar, false, true)).toBe(expected);
});

it.each([
  ["=_xlfn.ERF.PRECISE(1)", "=erf(1)"],
  ["=_xlfn.ERFC.PRECISE(1)", "=erfc(1)"],
  ["=_xlfn.GAMMALN.PRECISE(2)", "=gammaln(2)"],
  ["=_xlfngnumeric.SINPI(0.25)", "=sinpi(0.25)"],
  ["=_xlfnodf.SUMPRODUCT({1,2},{3,4})", "=sumproduct({1,2},{3,4})"],
  ["=ERF.PRECISE(1)", "=ERF.PRECISE(1)"]
])("imports only the released prefix-specific aliases: %s", (source, expected) => {
  const parsed = parseExpression(source, { position, grammar: excelGrammar });
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(serializeExpression(parsed.document)).toBe(source);
  expect(serializeExpression(parsed.document, gnumericGrammar, false, true)).toBe(expected);
});
