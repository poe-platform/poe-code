import { expect, it } from "vitest";
import { dayCount, gregorian, yearFraction } from "./functions/dates.js";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
const context: CapabilityContext = {
  signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 100000 },
  clock: { now: () => Date.UTC(2024, 0, 1, 12) }, own() {}
};
function calculate(formula: string, dateSystem: "1900" | "1904" = "1900", supplied = context) {
  const book: Workbook = { dateSystem, sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula, value: { kind: "number", value: 0 }, formulaDirty: true }
  ] }] };
  return recalculateWorkbook(book, supplied).sheets[0]!.cells[0]!.value;
}
// Expectations follow the released functions.c and hdate_strings.c branches.
it.each([
  ['=ISOYEAR(DATE(2021,1,1))', 2020], ['=ISOYEAR(DATE(2018,12,31))', 2019],
  ['=ISOYEAR(DATE(2024,6,1))', 2024],
  ['=DAYS360(DATE(2024,2,29),DATE(2024,3,31),99)', 31],
  ['=DAYS360(DATE(2024,2,29),DATE(2024,3,31),-1)', 31],
  ['=DAYS360(DATE(2024,2,29),DATE(2024,3,31),2)', 30],
  ['=DAYS360(DATE(2024,1,30),DATE(2024,2,29),2)', 30],
  ['=NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,7),{-1},{1;1;1;1;1;1;1})', 0],
  ['=WORKDAY(DATE(2024,1,1),0,{-1},{1;1;1;1;1;1;1})', 45292]
])("preserves released calendar branch %s", (formula, value) => {
  expect(calculate(formula as string)).toEqual({ kind: "number", value });
});
it("rejects invalid ISOYEAR serials with VALUE", () => {
  expect(calculate('=ISOYEAR(60)')).toEqual({ kind: "error", value: "#VALUE!" });
});
it.each([
  ['=HDATE_HEB(2024,1,11)', 'א׳ בְּשְׁבׇט התשפ״ד'],
  ['=HDATE_HEB(2024,10,3)', 'א׳ בְּת\u05bc\u05b4ש\u05c1\u05b0ר\u05b5י התשפ״ה'],
  ['=HDATE_HEB(2024,11,2)', 'א׳ בְּחֶשְׁוׇן התשפ״ה'],
  ['=HDATE_HEB(2024,4,23)', 'ט״ו בְּנִיסׇן התשפ״ד'],
  ['=HDATE_HEB(2024,3,11)', 'א׳ בְּאַדׇר ב׳ התשפ״ד'],
  ['=HDATE_HEB(2024,7,7)', 'א׳ בְּתׇּמוּז התשפ״ד']
])("preserves released Hebrew string bytes %s", (formula, value) => {
  expect(calculate(formula)).toEqual({ kind: "string", value });
});
it.each([
  ['=DAY(DATE(2024,1,1)+1-0.25/86400)', 2],
  ['=DATEVALUE(DATE(2024,1,1)+1-0.25/86400)', 45293],
  ['=WORKDAY(DATE(2024,1,1)+1-0.25/86400,0)', 45293],
  ['=NETWORKDAYS(DATE(2024,1,1)+1-0.25/86400,DATE(2024,1,2))', 1],
  ['=HOUR(-0.5)', 12], ['=MINUTE(-0.5+1/1440)', 1], ['=SECOND(-0.5+1/86400)', 1],
  ['=HDATE_JULIAN(0,0,0)', 1721028]
])("handles boundary serial %s", (formula, value) => {
  expect(calculate(formula as string)).toEqual({ kind: "number", value });
});
it.each([
  ['=NETWORKDAYS(0,1,{0},{1})', '#NUM!'],
  ['=WORKDAY(DATE(2024,1,1),1073741824,{0},{1})', '#NUM!'],
  ['=NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,7),{0},{1;1;1;1;1;1;#DIV/0!})', '#DIV/0!'],
  ['=WORKDAY(DATE(2024,1,1),1,{0},{1;1;1;1;1;1;#DIV/0!})', '#DIV/0!']
])("preserves validation order %s", (formula, value) => {
  expect(calculate(formula)).toEqual({ kind: "error", value });
});

it("uses configured local timezone for Unix conversion without a clock", () => {
  const supplied: CapabilityContext = { signal: context.signal, limits: context.limits, own: context.own, environment: { ...context.environment, timezone: "America/New_York" } };
  expect(calculate("=UNIX2DATE(1704067200)", "1900", supplied)).toEqual({ kind: "number", value: 45291 + 19 / 24 });
  expect(calculate("=DATE2UNIX(DATE(2024,1,1))", "1900", supplied)).toEqual({ kind: "number", value: 1704085200 });
});
it("preserves fractional Unix seconds smaller than a millisecond", () => {
  expect(calculate("=UNIX2DATE(0.0005)")).toEqual({ kind: "number", value: 25569 + .0005 / 86400 });
});

it.each([
  [2024, 1, 30, 2024, 3, 31, 61],
  [2024, 2, 29, 2024, 3, 31, 32],
  [2024, 10, 31, 2024, 12, 31, 61]
])("implements 30E+/360 end-day rollover from %s/%s/%s", (y1, m1, d1, y2, m2, d2, expected) => {
  const from = gregorian(y1, m1, d1), to = gregorian(y2, m2, d2);
  expect(dayCount(from, to, 5)).toBe(expected);
  expect(dayCount(to, from, 5)).toBe(-expected);
});

it("preserves the released unsupported annual-basis denominator in financial year fractions", () => {
  const from = gregorian(2024, 1, 30), to = gregorian(2024, 3, 31);
  expect(yearFraction(from, to, 5)).toBe(-61);
  expect(yearFraction(to, from, 5)).toBe(-61);
  expect(calculate("=YEARFRAC(DATE(2024,1,30),DATE(2024,3,31),5)")).toEqual({ kind: "error", value: "#NUM!" });
});
it.each(["1900", "1904"] as const)("preserves zero-based Hebrew month in the %s date system", dateSystem => {
  expect(calculate("=HDATE_MONTH(2024,1,1)", dateSystem)).toEqual({ kind: "number", value: 3 });
  expect(calculate("=HDATE_MONTH(2024,10,3)", dateSystem)).toEqual({ kind: "number", value: 0 });
});
