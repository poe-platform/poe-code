import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = { signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 100, workbookWork: 100000 }, own() {} };
it.each<[string, string | number, string]>([
  ['=ARABIC("ıx")', 10, 'number'], ['=ARABIC("ﬃV")', 5, 'number'],
  ['=ARABIC("Ⅰⅰ")', 0, 'number'], ['=ARABIC("I!V")', 4, 'number'],
  ['=ARABIC("-IV")', 4, 'number'], ['=ARABIC("MIM")', 1999, 'number'],
  ['=ROMAN(-.1)', '#VALUE!', 'error'], ['=ROMAN(3999.9,4.9)', 'MMMIM', 'string'],
  ['=ROMAN(4000)', '#VALUE!', 'error'], ['=ROMAN(1,-.1)', '#VALUE!', 'error'],
  ['=ROMAN(1,5)', '#VALUE!', 'error'], ['=ARABIC(0)', 0, 'number'],
  ['=ARABIC(TRUE)', 0, 'number'], ['=ROMAN(1,TRUE)', 'I', 'string'],
])("Roman independent case %s", (formula, value, kind) => {
  const result = recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet", cells: [{ row: 0, column: 0, formula, formulaDirty: true, value: { kind: "number", value: 0 } }] }] }, context);
  expect(result.sheets[0]!.cells[0]!.value).toEqual({ kind, value });
});
