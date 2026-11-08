import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
const context: CapabilityContext = { signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 100, workbookWork: 100000 }, own() {} };
function evaluate(formula: string) {
  return recalculateWorkbook({sheets:[{id:'s',name:'Sheet',cells:[{row:0,column:0,formula,formulaDirty:true,value:{kind:'number',value:0}}]}]},context).sheets[0]!.cells[0]!.value;
}
it.each<[string, string | number]>([
  ['=COMPLEX(2,-1,"j")','2-j'], ['=COMPLEX(2,0)',2], ['=IMREAL("2+3i")',2],
  ['=IMAGINARY("2+3i")',3], ['=IMABS("3+4i")',5], ['=IMCONJUGATE("2+3j")','2-3j'],
  ['=IMINV("i")','-i'], ['=IMNEG("2+i")','-2-i'], ['=IMDIV("1+i","1-i")','i'],
  ['=IMSUB("2+i","1+i")',1], ['=IMSUM("2+i","3-i")',5], ['=IMPRODUCT("i","i")',-1],
  ['=IMSQRT("-4")','2i'], ['=IMPOWER("i",2)',-1], ['=IMSIN(0)',0], ['=IMCOS(0)',1],
  ['=IMTAN(0)',0], ['=IMSEC(0)',1], ['=IMSINH(0)',0], ['=IMCOSH(0)',1], ['=IMTANH(0)',0],
  ['=IMSECH(0)',1], ['=IMEXP(0)',1], ['=IMLN(1)',0], ['=IMLOG10(1)',0], ['=IMLOG2(1)',0],
  ['=IMARGUMENT(1)',0], ['=IMARCSIN(0)',0], ['=IMARCCOS(1)',0], ['=IMARCTAN(0)',0],
  ['=IMARCSINH(0)',0], ['=IMARCCOSH(1)',0], ['=IMARCTANH(0)',0]
])("evaluates original complex fixture %s", (formula, value) => {
  expect(evaluate(formula)).toEqual({kind:typeof value==='string'?'string':'number',value});
});
it.each<[string,string]>([
  ['=IMREAL("bad")','#NUM!'], ['=COMPLEX(1,1,"I")','#VALUE!'], ['=IMDIV(1,0)','#DIV/0!'],
  ['=IMPOWER(0,0)','#DIV/0!']
])("preserves complex errors %s", (formula,value)=>expect(evaluate(formula)).toEqual({kind:'error',value}));
