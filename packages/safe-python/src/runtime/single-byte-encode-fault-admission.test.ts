import {expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {SingleByteTableCodec} from "./single-byte-table-codec.js";
import {singleByteTables} from "./single-byte-tables.js";

const codec=new SingleByteTableCodec(singleByteTables.find(table=>table.name==="cp1252")!,new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000}));
const input=new CodePointString(Uint32Array.of(0x100,0x101));

it.each(["strict","surrogatepass","callback-return","callback-throw"] as const)("admits single-byte encode faults before %s recovery",policy=>{
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:32});
  let called=false,failure:unknown;
  const errors=policy==="strict"||policy==="surrogatepass"?policy:()=>{
    called=true;
    if(policy==="callback-throw")throw new Error("guest failure");
    return {replacement:new Uint8Array(),position:2};
  };
  try{codec.encode(input,errors,meter);}catch(error){failure=error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason:"allocation"});
  expect(called).toBe(false);
  let retry:unknown;
  try{codec.encode(input,"ignore",meter);}catch(error){retry=error;}
  expect(retry).toBe(failure);
});

it("preserves grouped faults, callback failure identity and lazy recovery with admitted storage",()=>{
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000});
  expect(()=>codec.encode(input,"strict",meter)).toThrow(expect.objectContaining({
    name:"UnicodeEncodeError",encoding:"charmap",object:input,start:0,end:2,reason:"character maps to <undefined>"
  }));
  const failure=new Error("guest failure");
  expect(()=>codec.encode(input,()=>{throw failure;},meter)).toThrow(failure);
  const valid=new CodePointString(Uint32Array.of(65));
  expect(codec.encode(valid,()=>{throw failure;},meter)).toEqual(Uint8Array.of(65));
});
