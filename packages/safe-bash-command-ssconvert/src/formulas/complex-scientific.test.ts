import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
const context: CapabilityContext = { signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 100, workbookWork: 100000 }, own() {} };
it.each<[string,number]>([
  ['=IMGAMMA(6)',120], ['=IMFACT(5)',120], ['=IMIGAMMA(1,1)',.6321205588285577],
  ['=IMIGAMMA(-1,1)',1], ['=IMREAL(IMGAMMA("1+i"))',.498015668118356],
  ['=IMAGINARY(IMGAMMA("1+i"))',-Number("0.15494982830181068")]
])("evaluates original complex scientific fixture %s",(formula,value)=> {
  const result = recalculateWorkbook({sheets:[{id:'s',name:'Sheet',cells:[{row:0,column:0,formula,formulaDirty:true,value:{kind:'number',value:0}}]}]},context).sheets[0]!.cells[0]!.value;
  expect(result.kind).toBe('number');
  if(result.kind==='number') expect(result.value).toBeCloseTo(value,14);
});
