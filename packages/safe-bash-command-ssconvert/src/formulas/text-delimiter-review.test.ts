import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
import type { CellValue, Workbook } from "../workbook.js";

const context: CapabilityContext = {
  signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 1, operations: 100, workbookWork: 10000 },
  own() {}
};
function calculate(formula: string): CellValue {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula, value: { kind: "number", value: 999 }, formulaDirty: true }
  ] }] };
  return recalculateWorkbook(book, context).sheets[0]!.cells[0]!.value;
}

// Released find_delimiter_matches casefolds UTF-8, but retains original delimiter byte length.
it.each([
  ['=TEXTAFTER("aςb","Σ",1,1)', "b"],
  ['=TEXTBEFORE("aςb","Σ",1,1)', "a"],
  ['=INDEX(TEXTSPLIT("aςb","Σ",,FALSE,1),1,2)', "b"],
  ['=TEXTAFTER("aßb","SS",1,1)', "b"],
  ['=TEXTAFTER("aßxb","X",1,1)', "b"],
  ['=TEXTBEFORE("aßxb","X",1,1)', "aß"],
  ['=TEXTAFTER("aﬀxb","X",1,1)', "xb"]
])("checks folded-byte delimiter semantics %s", (formula, expected) => {
  expect(calculate(formula)).toEqual({ kind: "string", value: expected });
});

it.each(['=TEXTBEFORE("aﬀb","FF",1,0,0,7)', '=TEXTAFTER("aςb","Σ",1,0,0,7)'])("keeps case-sensitive negative control %s", formula => {
  expect(calculate(formula)).toEqual({ kind: "number", value: 7 });
});

it("refuses a folded match that would return invalid UTF-8 rather than fabricating text", () => {
  expect(() => calculate('=TEXTBEFORE("aﬀxb","X",1,1)')).toThrow("delimiter UTF-8 boundary");
});
