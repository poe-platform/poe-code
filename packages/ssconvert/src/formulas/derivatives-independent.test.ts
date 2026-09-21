import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import { normalCdf } from "./functions/normal-distribution.js";
import type { CapabilityContext } from "../contracts.js";

function context(workbookWork = 100000): CapabilityContext {
  return { signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork }, own() {} };
}
function calculate(formula: string, capability = context()) {
  return recalculateWorkbook({ sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 0, formula: `=${formula}`, value: { kind: "blank" }, formulaDirty: true }] }] }, capability).sheets[0]!.cells[0]!.value;
}
function number(formula: string): number {
  const result = calculate(formula);
  expect(result.kind).toBe("number");
  if (result.kind !== "number") throw new Error(`Expected number for ${formula}`);
  return result.value;
}

// Independently selected admissible inputs: execution/finite-result coverage,
// not native differential parity or numerical reference verification.
it.each([
  'OPT_BS("c",100,100,1,.05,.2,.03)',
  'OPT_BS_DELTA("c",100,100,1,.05,.2,.03)',
  'OPT_BS_RHO("c",100,100,1,.05,.2,.03)',
  'OPT_BS_THETA("c",100,100,1,.05,.2,.03)',
  'OPT_BS_GAMMA(100,100,1,.05,.2,.03)',
  'OPT_BS_VEGA(100,100,1,.05,.2,.03)',
  'OPT_BS_CARRYCOST("c",100,100,1,.05,.2,.03)',
  'CUM_BIV_NORM_DIST(.2,.3,.5)',
  'OPT_GARMAN_KOHLHAGEN("c",100,100,1,.05,.02,.2)',
  'OPT_FRENCH("c",100,100,.8,1,.05,.2,.03)',
  'OPT_JUMP_DIFF("c",100,100,1,.05,.2,1,.2)',
  'OPT_EXEC("c",100,100,1,.05,.2,.03,.1)',
  'OPT_BJER_STENS("c",100,100,1,.05,.2,.03)',
  'OPT_MILTERSEN_SCHWARTZ("c",.95,100,100,.5,1,.2,.1,.1,.2,.1,.1,.5,.5)',
  'OPT_BAW_AMER("c",100,100,1,.05,.2,.03)',
  'OPT_RGW(100,100,.5,1,.05,3,.2)',
  'OPT_FORWARD_START("c",100,1,.5,1,.05,.2,.03)',
  'OPT_TIME_SWITCH("c",100,100,1,1,0,.1,.05,.03,.2)',
  'OPT_SIMPLE_CHOOSER(100,100,.5,1,.05,.03,.2)',
  'OPT_COMPLEX_CHOOSER(100,100,100,.25,1,1,.05,.03,.2)',
  'OPT_ON_OPTIONS("cc",100,100,5,.5,1,.05,.03,.2)',
  'OPT_EXTENDIBLE_WRITER("c",100,100,105,.5,1,.05,.03,.2)',
  'OPT_2_ASSET_CORRELATION("c",100,100,100,100,1,.03,.03,.05,.2,.2,.5)',
  'OPT_EURO_EXCHANGE(100,100,1,1,1,.05,.03,.02,.2,.2,.5)',
  'OPT_AMER_EXCHANGE(100,100,1,1,1,.05,.03,.02,.2,.2,.5)',
  'OPT_SPREAD_APPROX("c",100,90,5,1,.05,.2,.2,.5)',
  'OPT_FLOAT_STRK_LKBK("c",100,90,110,1,.05,.03,.2)',
  'OPT_FIXED_STRK_LKBK("c",100,90,110,100,1,.05,.03,.2)',
  'OPT_BINOMIAL("e","c",20,100,100,1,.05,.2,.03)',
])("independently executes %s", formula => expect(Number.isFinite(number(formula))).toBe(true));

// Negative-tail constants independently computed from the erf series with
// 110-decimal-digit arithmetic, avoiding double-precision oracle tail error.
it.each([[0, .5], [1, .8413447460685429], [-1, Number("0.15865525393145705")], [-6, Number("9.8658764503769814e-10")], [-10, Number("7.619853024160526e-24")]])("checks independent normal probability at %s", (x, expected) => {
  expect(Math.abs(normalCdf(x!) / expected! - 1)).toBeLessThan(3e-15);
});

it("checks independent Black-Scholes values and analytic Greeks", () => {
  expect(number('OPT_BS("c",100,100,1,.05,.2,.05)')).toBeCloseTo(10.450583572185565, 12);
  expect(number('OPT_BS("p",100,100,1,.05,.2,.05)')).toBeCloseTo(5.573526022256971, 12);
  expect(number('OPT_BS_DELTA("c",100,100,1,.05,.2,.05)')).toBeCloseTo(.6368306511756191, 14);
  expect(number('OPT_BS_GAMMA(100,100,1,.05,.2,.05)')).toBeCloseTo(.018762017345846895, 14);
  expect(number('OPT_BS_VEGA(100,100,1,.05,.2,.05)')).toBeCloseTo(37.52403469169379, 12);
});

it("checks cross-model identities with the same carry", () => {
  const vanilla = number('OPT_BS("c",100,100,1,.05,.2,.03)');
  expect(number('OPT_GARMAN_KOHLHAGEN("c",100,100,1,.05,.02,.2)')).toBeCloseTo(vanilla, 12);
  expect(number('OPT_FRENCH("c",100,100,1,1,.05,.2,.03)')).toBeCloseTo(vanilla, 12);
  expect(number('OPT_EXEC("c",100,100,1,.05,.2,.03,0)')).toBeCloseTo(vanilla, 12);
});

it("checks Greeks against independent price perturbations", () => {
  const price = (s: number, v = .2, b = .03) => number(`OPT_BS("c",${s},100,1,.05,${v},${b})`);
  const step = .001, base = price(100), above = price(100 + step), below = price(100 - step);
  expect(number('OPT_BS_DELTA("c",100,100,1,.05,.2,.03)')).toBeCloseTo((above - below) / (2 * step), 8);
  expect(number('OPT_BS_GAMMA(100,100,1,.05,.2,.03)')).toBeCloseTo((above - 2 * base + below) / (step * step), 6);
  const rateStep = .00001;
  expect(number('OPT_BS_VEGA(100,100,1,.05,.2,.03)')).toBeCloseTo((price(100, .2 + rateStep) - price(100, .2 - rateStep)) / (2 * rateStep), 6);
  expect(number('OPT_BS_CARRYCOST("c",100,100,1,.05,.2,.03)')).toBeCloseTo((price(100, .2, .03 + rateStep) - price(100, .2, .03 - rateStep)) / (2 * rateStep), 6);
});

it.each(["OPT_BAW_AMER", "OPT_BJER_STENS"])("checks exercise and European lower bounds for %s", name => {
  for (const side of ["c", "p"]) {
    const european = number(`OPT_BS("${side}",100,100,1,.05,.2,.03)`);
    expect(number(`${name}("${side}",100,100,1,.05,.2,.03)`)).toBeGreaterThanOrEqual(european);
    const intrinsic = side === "c" ? 20 : 0;
    expect(number(`${name}("${side}",120,100,1,.05,.2,.03)`)).toBeGreaterThanOrEqual(intrinsic);
  }
});

it("bounds binomial allocation and nested work separately", () => {
  expect(() => calculate('OPT_BINOMIAL("e","c",1000,100,100,1,.05,.2)')).toThrow("calculation array limit exceeded");
  expect(() => calculate('OPT_BINOMIAL("e","c",100,100,100,1,.05,.2)', context(200))).toThrow("workbook work limit exceeded");
});

it("matches the captured native time-switch zero-step error", () => {
  expect(calculate('OPT_TIME_SWITCH("c",100,100,1,1,0,0,.05,.03,.2)')).toEqual({ kind: "error", value: "#NUM!" });
});

it("preserves released integer division in the opposite-sign bivariate branch", () => {
  expect(number('CUM_BIV_NORM_DIST((LN(100/105)+(.03+.2^2/2))/(.2),-((.03+.2^2/2)*.5/(.2*SQRT(.5))),-SQRT(.5))')).toBeCloseTo(.5933532382196917, 14);
  expect(number('OPT_EXTENDIBLE_WRITER("c",100,100,105,.5,1,.05,.03,.2)')).toBeCloseTo(56.070378219549234, 12);
});

it("interrupts a large time-switch loop and keeps invocations local", () => {
  expect(() => calculate('OPT_TIME_SWITCH("c",100,100,1,1,0,.00000001,.05,.03,.2)', context(100))).toThrow("workbook work limit exceeded");
  expect(number('OPT_BS("c",100,100,1,.05,.2,.05)')).toBeCloseTo(10.450583572185565, 12);
  const capability = context();
  const controller = new AbortController();
  const reason = new Error("independent cancellation");
  controller.abort(reason);
  expect(() => calculate('OPT_BINOMIAL("e","c",20,100,100,1,.05,.2)', { ...capability, signal: controller.signal })).toThrow(reason);
});
