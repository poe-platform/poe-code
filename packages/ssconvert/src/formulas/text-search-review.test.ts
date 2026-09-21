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
const n = (value: number): CellValue => ({ kind: "number", value });
const e = (value: string): CellValue => ({ kind: "error", value });

// Released fn-string/functions.c FIND/FINDB compare start against length+1
// before truncation. SEARCH delegates to gutils.c, allowing skip==length.
it.each<[string, CellValue]>([
  ['=FIND("c","abc",3.5)', n(3)],
  ['=FINDB("c","abc",3.5)', n(3)],
  ['=FIND("","abc",3.999)', n(3)],
  ['=FIND("","abc",4)', e("#VALUE!")],
  ['=SEARCH("","abc",4)', n(4)],
  ['=SEARCH("*","abc",4.5)', n(4)],
  ['=SEARCH("","",1)', n(1)],
  ['=SEARCH("?","abc",4)', e("#VALUE!")],
  ['=SEARCH("","abc",5)', e("#VALUE!")],
  ['=SEARCHB("","abc",4)', e("#VALUE!")],
  ['=SEARCHB("c","abc",3.5)', e("#VALUE!")],
  ['=SEARCH("","abc",2147483647)', e("#VALUE!")]
])("independently checks released search boundary %s", (formula, expected) => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula, value: n(999), formulaDirty: true }
  ] }] };
  expect(recalculateWorkbook(book, context).sheets[0]!.cells[0]!.value).toEqual(expected);
});

// ISODD obtains raw strings through go_strtod; whitespace accepted by the
// captured C locale differs from ECMAScript parseFloat's Unicode whitespace.
it.each<[string, boolean]>([
  [" ", true], ["\t", true], ["\n", true], ["\r", true], ["\v", true], ["\f", true],
  ["\u0085", false], ["\u00a0", false], ["\u1680", false], ["\u2000", false],
  ["\u2028", false], ["\u2029", false], ["\u202f", false], ["\u3000", false],
  ["\ufeff", false], [" \u00a0", false]
])("independently checks C-locale raw parity whitespace %j", (prefix, expected) => {
  const formula = `=ISODD("${prefix}-3.9suffix")`;
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula, value: n(999), formulaDirty: true }
  ] }] };
  expect(recalculateWorkbook(book, context).sheets[0]!.cells[0]!.value).toEqual({ kind: "boolean", value: expected });
});

it.each<[string, CellValue]>([
  ['=TEXTAFTER("ﬁ-X","-",1,1)', { kind: "string", value: "-X" }],
  ['=TEXTAFTER("aİ-b","-",1,1)', { kind: "string", value: "" }],
  ['=TEXTBEFORE("aİ-b","-",1,1)', { kind: "string", value: "aİ-" }],
  ['=TEXTBEFORE("akb","K",1,1)', { kind: "string", value: "a" }],
  ['=TEXTAFTER("aı-b","I",1,1,0,17)', n(17)],
  ['=TEXTAFTER("aéb","é",1,1,0,17)', n(17)],
  ['=TEXTAFTER("aςb","Σ",1,2,0,17)', n(17)],
  ['=TEXTAFTER("aςb","Σ",1,1.99)', { kind: "string", value: "b" }],
  ['=TEXTAFTER("aςbςc","Σ",-1,1)', { kind: "string", value: "c" }]
])("independently checks folded-byte offsets and negative controls %s", (formula, expected) => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula, value: n(999), formulaDirty: true }
  ] }] };
  expect(recalculateWorkbook(book, context).sheets[0]!.cells[0]!.value).toEqual(expected);
});

it.each(['=TEXTBEFORE("ﬁ-X","-",1,1)', '=TEXTAFTER("akb","K",1,1)'])(
  "keeps invalid UTF-8 or out-of-string folded endpoints unsupported for %s", formula => {
    const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
      { row: 0, column: 0, formula, value: n(999), formulaDirty: true }
    ] }] };
    expect(() => recalculateWorkbook(book, context)).toThrow("delimiter UTF-8 boundary");
  }
);
