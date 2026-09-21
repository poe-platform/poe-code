import { expect, it } from "vitest";
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
it.each([
  ["=DATE(1900,3,1)", 61], ["=DATE(1900,2,29)", 61], ["=DATE(2024,1,1)", 45292],
  ["=EDATE(DATE(2024,1,31),1)", 45351], ["=EOMONTH(DATE(2024,2,1))", 45351],
  ["=DATEDIF(DATE(2023,1,31),DATE(2023,3,1),\"m\")", 1],
  ["=DAYS(DATE(1900,3,1),DATE(1900,2,28))", 1],
  ["=NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,7))", 5],
  ["=WORKDAY(DATE(2024,1,5),1)", 45299], ["=TIME(25,0,0)", 1 / 24],
  ["=ODF.TIME(-1,0,0)", -1 / 24], ["=ISOWEEKNUM(DATE(2021,1,1))", 53],
  ["=EASTERSUNDAY(2024)", 45382], ["=HDATE_YEAR(2024,1,1)", 5784],
  ["=PV(0,10,-100)", 1000], ["=FV(0,10,-100)", 1000], ["=PMT(0,10,1000)", -100],
  ["=IRR({-100;110})", .1], ["=RATE(1,0,-100,110)", .1],
  ['=OPT_BS("c",100,100,1,0.05,0.2,0.05)', 10.450583572185565]
] as const)("calculates released date/finance case %s", (formula, value) => {
  expect(calculate(formula).kind).toBe("number");
  expect(calculate(formula)).toEqual({ kind: "number", value: expect.closeTo(value, 10) });
});
it("uses the workbook date system", () => expect(calculate("=DATE(1904,1,1)", "1904")).toEqual({ kind: "number", value: 0 }));
it("uses the injected clock and declared timezone", () => {
  const supplied = { ...context, environment: { ...context.environment, timezone: "America/New_York" } };
  expect(calculate("=NOW()", "1900", supplied)).toEqual({ kind: "number", value: 45292 + 7 / 24 });
});

it.each(["DAY", "YEAR", "MONTH"])("rejects the nonexistent leap day in %s", name => expect(calculate(`=${name}(60)`)).toEqual({ kind: "error", value: "#NUM!" }));
it.each([
  ["=ACCRINT(DATE(2024,1,1),DATE(2024,7,1),DATE(2024,4,1),.1,1000,2,0)", 25],
  ["=AMORLINC(1000,DATE(2024,1,1),DATE(2025,1,1),0,1,.1,3)", 100],
  ["=AMORDEGRC(1000,DATE(2024,1,1),DATE(2025,1,1),0,1,.1,0)", 188],
  ["=PRICEMAT(DATE(2024,7,1),DATE(2025,1,1),DATE(2024,1,1),.1,.1,0)", 100 * 1.1 / 1.05 - 5],
  ["=YIELDMAT(DATE(2024,7,1),DATE(2025,1,1),DATE(2024,1,1),.1,100,0)", (1.1 / 1.05 - 1) / .5],
  ["=ODDLPRICE(DATE(2024,7,1),DATE(2025,1,1),DATE(2024,7,1),.1,.1,100,2,0)", 100],
  ["=ODDLYIELD(DATE(2024,7,1),DATE(2025,1,1),DATE(2024,7,1),.1,100,100,2,0)", .1],
  ["=ODDFPRICE(DATE(2024,1,1),DATE(2025,1,1),DATE(2024,1,1),DATE(2024,7,1),.1,.1,100,2,0)", 100],
  ["=ODDFYIELD(DATE(2024,1,1),DATE(2025,1,1),DATE(2024,1,1),DATE(2024,7,1),.1,100,100,2,0)", .1]
] as const)("calculates coupon/amortization case %s", (formula, value) => expect(calculate(formula)).toEqual({ kind: "number", value: expect.closeTo(value, 10) }));
