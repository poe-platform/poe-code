import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { recalculateWorkbook } from "./evaluator.js";
const context: CapabilityContext = { signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 100, workbookWork: 100000 }, own() {} };
it.each<[string, number]>([
  ['=MDETERM({2,1;1,2})',3], ['=INDEX(MMULT({2,1;1,2},{1;3}),2,1)',7],
  ['=INDEX(MINVERSE({2,0;0,4}),2,2)',.25], ['=INDEX(MUNIT(3),2,2)',1],
  ['=INDEX(LINSOLVE({2,1;1,2},{4;5}),1,1)',1], ['=INDEX(CHOLESKY({4,2;2,2}),2,1)',1],
  ['=INDEX(EIGEN({2,0;0,1}),1,1)',2], ['=INDEX(MPSEUDOINVERSE({2,0;0,0}),1,1)',.5]
])("evaluates original matrix %s",(formula,value)=> {
  const result = recalculateWorkbook({sheets:[{id:'s',name:'Sheet',cells:[{row:0,column:0,formula,formulaDirty:true,value:{kind:'number',value:0}}]}]},context);
  expect(result.sheets[0]!.cells[0]!.value).toEqual({kind:'number',value});
});
