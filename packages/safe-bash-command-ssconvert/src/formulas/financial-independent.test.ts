import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
import type { Cell, Workbook } from "../workbook.js";
const context: CapabilityContext = {
  signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 100000 },
  clock: { now: () => 0 }, own() {}
};
function calculate(formula: string, extra: readonly Cell[] = []) {
  const book: Workbook = { dateSystem: "1900", sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula, value: { kind: "number", value: 0 }, formulaDirty: true }, ...extra
  ] }] };
  return recalculateWorkbook(book, context).sheets[0]!.cells[0]!.value;
}
it.each([
  ["=FV(-2,2,0,100)", -100],
  ["=PMT(.1,2,100,0,2)", -110 / 2.1],
  ["=PMT(.1,2,100,0,-.5)", -110 / 2.1],
  ["=SYD(100,0,2,4)", -100 / 3],
  ["=IRR({-100;200100},2000)", 2000],
  ["=RATE(1,0,-100,200100)", 2000],
  ["=IRR({-100;50})", -.5]
] as const)("matches independent source case %s", (formula, value) => {
  expect(calculate(formula)).toEqual({ kind: "number", value: expect.closeTo(value, 10) });
});
it.each([
  ["=IRR({-100;200100})", "#NUM!"],
  ["=RRI(0,100,110)", "#DIV/0!"], ["=RRI(1,0,110)", "#DIV/0!"],
  ["=RATE(1,0,-100,100,0,0)", "#NUM!"],
  ["=PRICE(DATE(2024,1,1),DATE(2025,1,1),.1,-.1,100,2,0)", "#NUM!"]
] as const)("matches independent source error %s", (formula, value) => {
  expect(calculate(formula)).toEqual({ kind: "error", value });
});

it.each([
  ["=ISPMT(.1,1.9,3.9,100)", -20 / 3],
  ["=DDB(100,0,4,1.5)", 50 * Math.sqrt(.5)],
  ["=DDB(100,0,4,.5)", 50],
  ["=DB(100,0,2,1,24)", 200],
  ["=DB(100,0,2,0)", 0],
  ["=ACCRINTM(DATE(2024,1,31),DATE(2024,2,29),.1,1000,0)", 100 * 28 / 360],
  ["=ACCRINTM(DATE(2024,1,31),DATE(2024,2,29),.1,1000,4)", 100 * 28 / 360],
  ["=ACCRINTM(DATE(2024,2,29),DATE(2024,3,31),.1,1000,0)", 100 * 31 / 360],
  ["=PRICEDISC(DATE(2024,1,31),DATE(2024,2,29),.1,100,0)", 100 * (1 - .1 * 28 / 360)],
  ["=DURATION(DATE(2024,4,1),DATE(2025,1,1),0,.1,2,0)", 1],
  ["=MDURATION(DATE(2024,4,1),DATE(2025,1,1),0,.1,2,0)", 1 / 1.05],
  ["=MIRR({-100;110},.1,.1)", .1],
  ["=XNPV(.1,{-100;110},{1;366})", 0],
  ["=XIRR({-100;110},{1;366})", .1],
  ["=EURO(\"DEM\")", 1.95583],
  ["=DOLLARDE(1.02,16)", 1.125], ["=DOLLARFR(-1.125,16)", -1.02],
  ["=EFFECT(.1,2)", .1025], ["=NOMINAL(.1025,2)", .1],
  ["=G_DURATION(.1,100,110)", 1], ["=NPV(.1,110,TRUE)", 100],
  ["=INTRATE(DATE(2024,1,1),DATE(2025,1,1),100,110,0)", .1],
  ["=RECEIVED(DATE(2024,1,1),DATE(2025,1,1),100,.1,0)", 100 / .9],
  ["=DISC(DATE(2024,1,1),DATE(2025,1,1),90,100,0)", .1],
  ["=YIELDDISC(DATE(2024,1,1),DATE(2025,1,1),100,110,0)", .1],
  ["=TBILLPRICE(1,181,.1)", 95], ["=TBILLYIELD(1,181,95)", 10 / 95],
  ["=TBILLEQ(1,181,.1)", 36.5 / 342],
  ["=COUPNUM(DATE(2024,4,1),DATE(2025,1,1),2)", 2],
  ["=COUPDAYBS(DATE(2024,4,1),DATE(2025,1,1),2,0)", 90],
  ["=COUPDAYS(DATE(2024,4,1),DATE(2025,1,1),2,0)", 180],
  ["=COUPDAYSNC(DATE(2024,4,1),DATE(2025,1,1),2,0)", 90],
  ["=COUPPCD(DATE(2024,4,1),DATE(2025,1,1),2,0)", 45292],
  ["=COUPNCD(DATE(2024,4,1),DATE(2025,1,1),2,0)", 45474],
  ["=VDB(100,0,4,0,4)", 100], ["=SLN(100,0,4)", 25],
  ["=RRI(1,100,110)", .1], ["=EUROCONVERT(1,\"DEM\",\"EUR\",FALSE)", .51]
] as const)("covers financial source branch %s", (formula, value) => expect(calculate(formula)).toEqual({ kind: "number", value: expect.closeTo(value, 10) }));
it.each([
  ["=SLN(100,0,0)", "#NUM!"], ["=ISPMT(.1,0,3,100)", "#NUM!"],
  ["=DDB(100,0,4,0)", "#NUM!"], ["=DB(0,0,4,1)", "#NUM!"],
  ["=ACCRINTM(1,2,.1,1000,5)", "#NUM!"],
  ["=ACCRINTM(1,2,.1,1000,-.5)", "#NUM!"],
  ["=COUPDAYS(1,366,2,-.5)", "#NUM!"],
  ["=YIELDDISC(1,366,-1,100,0)", "#NUM!"],
  ["=MIRR({-100;110},.1,-2)", "#DIV/0!"],
  ["=FVSCHEDULE(100,{.1;\"bad\"})", "#VALUE!"]
] as const)("covers financial source invalid input %s", (formula, value) => expect(calculate(formula)).toEqual({ kind: "error", value }));

it.each(["XNPV(.1,B1:B3,C1:C3)", "XIRR(B1:B3,C1:C3)"])("ignores aligned blank pairs in %s", expression => {
  const result = calculate(`=${expression}`, [
    { row: 0, column: 1, value: { kind: "number", value: -100 } },
    { row: 1, column: 1, value: { kind: "number", value: 999 } },
    { row: 2, column: 1, value: { kind: "number", value: 110 } },
    { row: 0, column: 2, value: { kind: "number", value: 1 } },
    { row: 2, column: 2, value: { kind: "number", value: 366 } }
  ]);
  expect(result).toEqual({ kind: "number", value: expect.closeTo(expression.startsWith("XNPV") ? 0 : .1, 10) });
});
it("resolves the IRR bracket toward a multiple root", () => {
  expect(calculate("=IRR({-100;200;-100})")).toEqual({ kind: "number", value: expect.closeTo(0, 6) });
});
it.each([
  ["=VDB(100,0,4,3,4,2,.5)", 12.5],
  ["=VDB(100,0,4,1.5,3.5,2,TRUE)", 28.125],
  ["=VDB(100,10,5,2.5,4.5,1)", 35],
  ["=VDB(100,0,0,0,0)", 0]
] as const)("matches VDB fractional branch %s", (formula, value) => expect(calculate(formula)).toEqual({ kind: "number", value: expect.closeTo(value, 10) }));
it("rejects the reference no-switch VDB range cap", () => expect(calculate("=VDB(100,0,20000,0,10001,2,TRUE)")).toEqual({ kind: "error", value: "#VALUE!" }));
it("uses the reference exact-base power path", () => expect(calculate("=FV(.5,10,0,1)")).toEqual({ kind: "number", value: -57.6650390625 }));
it.each([
  ["=IPMT(.1,1,2,100)", -10], ["=PPMT(.1,1,2,100)", -100 * 1.21 / 2.1 + 10],
  ["=CUMIPMT(.1,2,100,1,2,0)", -10 - 110 / 2.1 * .1],
  ["=CUMPRINC(.1,2,100,1,2,0)", -100],
  ["=CUMIPMT(.1,2,100,1,2,1)", -100 * .1 / 2.1],
  ["=NPER(.1,-100 * 1.21 / 2.1,100)", 2],
  ["=YIELD(DATE(2024,7,1),DATE(2025,1,1),.1,110,100,2,0)", -1 / 11],
  ["=PRICE(DATE(2024,1,1),DATE(2024,1,1),.1,.1,100,2,0)", 100],
  ["=YIELD(DATE(2024,1,1),DATE(2025,1,1),.1,100,100,2,0)", .1]
] as const)("covers annuity/yield branch %s", (formula, value) => expect(calculate(formula)).toEqual({ kind: "number", value: expect.closeTo(value, 10) }));
it.each([
  ["=EUROCONVERT(-1.005,\"EUR\",\"EUR\",FALSE)", -1.01],
  ["=EUROCONVERT(-1.0005,\"EUR\",\"EUR\",TRUE,3)", -1.001]
] as const)("rounds signed Euro ties per reference %s", (formula, value) => expect(calculate(formula)).toEqual({ kind: "number", value }));
it("rounds negative French depreciation ties to even", () => expect(calculate("=AMORDEGRC(-10,DATE(2024,1,1),DATE(2025,1,1),0,0,.1,0)")).toEqual({ kind: "number", value: -2 }));

// Authenticated released native oracle: out/ssconvert-date-finance-comparison.json.
it.each([
  ["=PRICE(DATE(2024,1,1),DATE(2025,1,1),.1,0,100,2,0)", "#NUM!"],
  ["=IRR({-1;TRUE})", "#VALUE!"],
  ["=FVSCHEDULE(100,{.1;TRUE})", "#VALUE!"],
  ["=MIRR({-100;TRUE},.1,.1)", "#VALUE!"],
  ["=XNPV(.1,{-100;TRUE},{1;366})", "#VALUE!"],
  ["=IRR({-100;#DIV/0!})", "#DIV/0!"],
  ["=FVSCHEDULE(100,{.1;#DIV/0!})", "#DIV/0!"]
] as const)("preserves released collection and zero-yield failure %s", (formula, value) => expect(calculate(formula)).toEqual({ kind: "error", value }));
it("keeps the released finite zero-yield one-coupon formula", () => expect(calculate("=PRICE(DATE(2024,7,1),DATE(2025,1,1),.1,0,100,2,0)")).toEqual({ kind: "number", value: 105 }));
it("matches the captured aarch64 FMA IRR multiple-root residual", () => expect(calculate("=IRR({-100;200;-100})")).toEqual({ kind: "number", value: expect.closeTo(5.907981582180289e-9, 20) }));
