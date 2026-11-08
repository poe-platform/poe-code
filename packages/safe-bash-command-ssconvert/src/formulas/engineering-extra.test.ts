import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
const context: CapabilityContext = { signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 100, workbookWork: 100000 }, own() {} };
it.each<[string, string | number]>([
  ['=CONVERT(1,"m","cm")',100], ['=CONVERT(32,"F","C")',0], ['=CONVERT(3,"Yibyte","bit")',3*2**83],
  ['=HEXREP(1.5)','0x1.8p+0'], ['=HEXREP(0)','0x0p+0'], ['=INVSUMINV(12,6)',4]
])("evaluates original engineering fixture %s",(formula,value)=> {
  const result = recalculateWorkbook({sheets:[{id:'s',name:'Sheet',cells:[{row:0,column:0,formula,formulaDirty:true,value:{kind:'number',value:0}}]}]},context);
  expect(result.sheets[0]!.cells[0]!.value).toEqual({kind:typeof value==='string'?'string':'number',value});
});
