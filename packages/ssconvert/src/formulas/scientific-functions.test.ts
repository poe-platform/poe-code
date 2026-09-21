import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
const context: CapabilityContext = { signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 100, workbookWork: 100000 }, own() {} };
it.each<[string, number]>([
  ['=GAMMA(6)',120], ['=GAMMALN(1)',0], ['=POCHHAMMER(3,4)',360], ['=LAMBERTW(0)',0],
  ['=DIGAMMA(1)',-.5772156649015329], ['=GAMMA(.5)',Math.sqrt(Math.PI)], ['=BETA(2,3)',1/12],
  ['=BETALN(1,1)',0]
])("evaluates original scientific fixture %s",(formula,value)=> {
  const result = recalculateWorkbook({sheets:[{id:'s',name:'Sheet',cells:[{row:0,column:0,formula,formulaDirty:true,value:{kind:'number',value:0}}]}]},context);
  expect(result.sheets[0]!.cells[0]!.value.kind).toBe('number');
  if(result.sheets[0]!.cells[0]!.value.kind==='number') expect(result.sheets[0]!.cells[0]!.value.value).toBeCloseTo(value,14);
});
