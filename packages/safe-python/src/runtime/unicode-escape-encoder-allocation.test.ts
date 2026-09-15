import {expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {encodeUnicodeEscape} from "./unicode-escape.js";

it.each([false,true])("bounds retained empty escape encoder outputs (raw=%s)",raw=>{
  const input=new CodePointString(new Uint32Array());
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:1024});
  const outputs:Uint8Array[]=[];
  let failure:unknown;
  try {
    for(let index=0;index<100;index++)outputs.push(encodeUnicodeEscape(input,raw,meter));
  }catch(error){failure=error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason:"allocation"});
  expect(outputs.length).toBeGreaterThan(0);
  expect(outputs.length).toBeLessThan(100);
  expect(new Set(outputs).size).toBe(outputs.length);
  for(const output of outputs)expect([...output]).toEqual([]);
  let retry:unknown;
  try{encodeUnicodeEscape(input,raw,meter);}catch(error){retry=error;}
  expect(retry).toBe(failure);
});

it.each([false,true])("denies empty escape encoder storage with no allocation budget (raw=%s)",raw=>{
  const input=new CodePointString(new Uint32Array());
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:0});
  expect(()=>encodeUnicodeEscape(input,raw,meter)).toThrow(ExecutionLimitError);
});
