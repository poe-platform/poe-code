import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
const context: CapabilityContext = { signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 100, workbookWork: 100000 }, own() {} };
it.each<[string,number]>([
  ['=BESSELJ(0,0)',1], ['=BESSELI(0,1)',0], ['=BESSELJ(1,0)',.7651976865579666],
  ['=BESSELI(1,0)',1.2660658777520084], ['=BESSELK(1,0)',.4210244382407083],
  ['=BESSELY(1,0)',.08825696421567696], ['=ERF(0)',0], ['=ERFC(0)',1],
  ['=ERF(1)',.8427007929497149], ['=ERFC(1)',.15729920705028513],
  ['=IGAMMA(1,1)',.6321205588285577], ['=REDUCEPI(0,1)',0]
])("evaluates original special numeric fixture %s",(formula,value)=> {
  const result = recalculateWorkbook({sheets:[{id:'s',name:'Sheet',cells:[{row:0,column:0,formula,formulaDirty:true,value:{kind:'number',value:0}}]}]},context).sheets[0]!.cells[0]!.value;
  expect(result.kind).toBe('number');
  if(result.kind==='number') expect(result.value).toBeCloseTo(value,14);
});
