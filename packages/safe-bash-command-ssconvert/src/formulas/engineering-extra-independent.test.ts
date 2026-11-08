import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "./evaluator.js";

const context: CapabilityContext = { signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 100, workbookWork: 100000 }, own() {} };
function calculate(formula: string) {
  return recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, formula, formulaDirty: true, value: { kind: "number", value: 0 } }
  ] }] }, context).sheets[0]!.cells[0]!.value;
}
it.each<[string, number | string]>([
  ['=CONVERT(0,"m","g")', '#NUM!'],
  ['=CONVERT(1,"unknown","m")', '#N/A'],
  ['=CONVERT(1,"byte","Yibyte")', '#NUM!'],
  ['=CONVERT(1,"Yibyte","byte")', 2 ** 80],
  ['=CONVERT(-1,"K","K")', '#NUM!'],
  ['=CONVERT(-273.15,"C","K")', 0],
  ['=CONVERT(1,"m","dam")', '#NUM!'],
  ['=CONVERT(1,"em","m")', 10],
  ['=CONVERT(1e308,"Ym","Ym")', '#NUM!'],
  ['=HEXREP(FLT.NEXTAFTER(0,"+"))', '0x0.0000000000001p-1022'],
  ['=HEXREP(FLT.MIN()/2)', '0x0.8p-1022'],
  ['=HEXREP(-FLT.NEXTAFTER(0,"+"))', '-0x0.0000000000001p-1022'],
  ['=HEXREP(-0)', '0x0p+0'],
  ['=HEXREP(1/0)', '#DIV/0!'],
  ['=INVSUMINV()', '#VALUE!'],
  ['=INVSUMINV("12",TRUE)', '#VALUE!'],
  ['=INVSUMINV(0,-1)', '#VALUE!'],
  ['=INVSUMINV(1,1/0)', '#DIV/0!'],
  ['=INVSUMINV(1e308,1e308)', 5e307],
  ['=INVSUMINV(FLT.NEXTAFTER(0,"+"))', 0],
  ['=CONVERT(1,"tsp","Pica3")', 112265.99999999997],
  ['=CONVERT(1,"tsp","Pica^3")', 112265.99999999997],
  ['=CONVERT(1,"tsp","Picapt3")', 112265.99999999997],
  ['=CONVERT(1,"tsp","Picapt^3")', 112265.99999999997],
  ['=INVSUMINV(-1,1/0)', '#DIV/0!'],
  ['=INVSUMINV(0,-1,1/0)', '#DIV/0!'],
  ['=INVSUMINV(-1,NA())', '#N/A'],
])("independent engineering source/oracle case %s", (formula, expected) => {
  expect(calculate(formula)).toEqual({
    kind: typeof expected === "string" ? expected.startsWith("#") ? "error" : "string" : "number", value: expected
  });
});
