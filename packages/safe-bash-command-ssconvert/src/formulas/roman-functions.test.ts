import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
const context: CapabilityContext = { signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 100, workbookWork: 100000 }, own() {} };
it.each<[string, string | number]>([
  ['=ROMAN(999)','CMXCIX'], ['=ROMAN(999,1)','LMVLIV'], ['=ROMAN(999,2)','XMIX'],
  ['=ROMAN(999,3)','VMIV'], ['=ROMAN(999,4)','IM'], ['=ARABIC("! xix ?")',19]
])("evaluates original Roman fixture %s",(formula,value)=> {
  const result = recalculateWorkbook({sheets:[{id:'s',name:'Sheet',cells:[{row:0,column:0,formula,formulaDirty:true,value:{kind:'number',value:0}}]}]},context);
  expect(result.sheets[0]!.cells[0]!.value).toEqual({kind:typeof value==='string'?'string':'number',value});
});
