import { expect, it } from "vitest";
import { parseExpression } from "./parser.js";
import { serializeExpression } from "./serialization.js";
import { excelGrammar, gnumericGrammar, odfGrammar } from "./conventions.js";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
const position = { sheet: "s", row: 0, column: 0 };
const context: CapabilityContext = { signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 10, operations: 100, workbookWork: 100000 }, clock: { now: () => Date.UTC(2024, 0, 1) }, own() {} };
it.each([
  ["=HDATE_YEAR(2024,1,1)", "=_xlfngnumeric.HDATE_YEAR(2024,1,1)", "of:=ORG.GNUMERIC.HDATE_YEAR(2024;1;1)"],
  ["=G_DURATION(.1,100,200)", "=_xlfngnumeric.G_DURATION(0.1,100,200)", "of:=PDURATION(0.1;100;200)"],
  ["=ODF.TIME(-1,0,0)", "=ODF.TIME(-1,0,0)", "of:=TIME(-1;0;0)"],
  ["=TIME(25,0,0)", "=TIME(25,0,0)", "of:=ORG.GNUMERIC.TIME(25;0;0)"],
  ["=EASTERSUNDAY(2024)", "=_xlfngnumeric.EASTERSUNDAY(2024)", "of:=EASTERSUNDAY(2024)"],
  ["=EASTERSUNDAY()", "=_xlfngnumeric.EASTERSUNDAY()", "of:=ORG.GNUMERIC.EASTERSUNDAY()"],
  ['=OPT_BS("c",100,100,1,.05,.2)', '=_xlfngnumeric.OPT_BS("c",100,100,1,0.05,0.2)', 'of:=ORG.GNUMERIC.OPT_BS("c";100;100;1;0.05;0.2)']
])("retains calendar/finance expressions across grammars: %s", (source, excel, odf) => {
  const parsed = parseExpression(source, { position }); if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  expect(serializeExpression(parsed.document, excelGrammar, false, true)).toBe(excel);
  expect(serializeExpression(parsed.document, odfGrammar, false, true)).toBe(odf);
  for (const [expression, grammar] of [[excel, excelGrammar], [odf, odfGrammar]] as const) {
    const imported = parseExpression(expression, { position, grammar }); if (!imported.ok) throw new Error(imported.diagnostic.message);
    expect(serializeExpression(imported.document, gnumericGrammar, false, true)).toBe(serializeExpression(parsed.document, gnumericGrammar, false, true));
  }
});
it.each(["1900", "1904"] as const)("preserves numeric serials and %s metadata through expression conversion", dateSystem => {
  const formula = '=DATE(2024,1,1)+TIME(12,0,0)';
  const book = recalculateWorkbook({ dateSystem, sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 0, formula, formulaDirty: true, value: { kind: "number", value: 0 } }] }] }, context);
  expect(book.dateSystem).toBe(dateSystem);
  expect(book.sheets[0]!.cells[0]!.formula).toBe(formula);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: dateSystem === "1900" ? 45292.5 : 43830.5 });
});
