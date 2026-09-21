import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";

it.each<[string, number | string]>([
  ["=GAMMA(0.125)", 7.533941598797612],
  ["=GAMMA(1.25)", .906402477055477],
  ["=GAMMA(10.25)", 639232.5987795768],
  ["=GAMMA(1e-300)", 9.999999999999999e299],
  ["=GAMMA(1e-308)", 1e308],
  ["=GAMMA(30)", 8.841761993739702e30],
  ["=GAMMA(33.97597403731027)", 7.980835739613098e36],
  ["=GAMMA(30.5)", 4.822696933490909e31],
  ["=GAMMA(170.5)", 5.56209241456e305],
  ["=GAMMA(-0.125)", -8.717218859383175],
  ["=GAMMA(-10.25)", -6.780818043294673e-7],
  ["=GAMMA(-169.5)", 5.6482208842233253e-306],
  ["=GAMMA(-3.0565437956300383)", 2.758723486669502],
  ["=GAMMA(-170.25)", -1.6938387496514192e-307],
  ["=GAMMA(-170.5)", -3.3127395215386074e-308],
  ["=HEXREP(GAMMA(-171.25))", "0x0.0b613eac8c702p-1022"],
  ["=HEXREP(GAMMA(-171.5))", "0x0.0238ee05c879ep-1022"],
  ["=HEXREP(GAMMA(-173.25))", "0x0.000018fdb557fp-1022"],
  ["=HEXREP(GAMMA(-174.5))", "-0x0.0000000723a81p-1022"],
  ["=HEXREP(GAMMA(-177.5))", "0x0.0000000000001p-1022"]
])("rounds the independently referenced gamma value %s", (formula, value) => {
  const workbook = recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, formula, formulaDirty: true, value: { kind: "number", value: 0 } }
  ] }] }, {
    signal: new AbortController().signal,
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 1000, outputBytes: 1000, cells: 10, sheets: 1,
      operations: 10, workbookWork: 10000 }, own() {}
  });
  expect(workbook.sheets[0]!.cells[0]!.value).toEqual({ kind: typeof value === "number" ? "number" : "string", value });
});
