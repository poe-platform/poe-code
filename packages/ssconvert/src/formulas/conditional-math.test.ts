import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
const context: CapabilityContext = { signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 100, workbookWork: 100000 }, own() {} };
it.each<[string, number]>([
  ['=COUNTIF(A1:A3,">2")',2], ['=SUMIF(A1:A3,">2")',8], ['=AVERAGEIF(A1:A3,">2")',4],
  ['=COUNTIFS(A1:A3,">2",A1:A3,"<5")',1], ['=SUMIFS(A1:A3,A1:A3,">2")',8],
  ['=AVERAGEIFS(A1:A3,A1:A3,">2")',4], ['=MINIFS(A1:A3,A1:A3,">2")',3], ['=MAXIFS(A1:A3,A1:A3,">2")',5]
])("evaluates original conditional math %s", (formula, value) => {
  const result = recalculateWorkbook({sheets:[{id:'s',name:'Sheet',cells:[
    ...[1,3,5].map((value,row)=>({row,column:0,value:{kind:'number' as const,value}})),
    {row:0,column:1,formula,formulaDirty:true,value:{kind:'number',value:0}}
  ]}]},context);
  expect(result.sheets[0]!.cells[3]!.value).toEqual({kind:'number',value});
});
