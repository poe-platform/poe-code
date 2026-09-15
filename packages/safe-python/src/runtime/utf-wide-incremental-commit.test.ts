import {expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget,ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {WideUnicodeDecoder} from "./utf-wide-incremental.js";
import {encodeWideUnicode} from "./utf-wide.js";

const cases=([16,32] as const).flatMap(width=>([-1,1] as const).flatMap(order=>
  (["cancelled","allocation","steps"] as const).map(reason=>({width,order,reason}))));

it.each(cases)("commits UTF-$width BOM order and buffered bytes together on $reason (order=$order)",({width,order,reason})=>{
  const encoded=encodeWideUnicode(new CodePointString(Uint32Array.of(0xfeff,65)),width,order);
  // Leave one incomplete code unit after the BOM and a complete character.
  const input=new Uint8Array(encoded.length+1);
  input.set(encoded);
  input[input.length-1]=66;
  const create=()=>{
    const decoder=new WideUnicodeDecoder(width);
    decoder.decode(input.slice(0,1));
    return decoder;
  };
  const reference=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
  let checkpoints=0;
  const success=create();
  expect([...success.decode(input.slice(1),false,{checkpoint(steps,bytes){checkpoints++;reference.checkpoint(steps,bytes);}})]).toEqual([65]);
  expect(success.getstate()).toEqual([Uint8Array.of(66),order===-1?0n:1n]);

  const controller=new AbortController();
  const budget=new ExecutionBudget({
    maxSteps:reference.usage.steps-(reason==="steps"?1:0),
    maxAllocatedBytes:reference.usage.allocatedBytes-(reason==="allocation"?1:0),
    signal:controller.signal
  });
  let calls=0;
  const meter:ExecutionMeter={checkpoint(steps,bytes){
    calls++;
    if(reason==="cancelled"&&calls===checkpoints)controller.abort();
    budget.checkpoint(steps,bytes);
  }};
  const decoder=create(),before=decoder.getstate();
  let failure:unknown;
  try{decoder.decode(input.slice(1),false,meter);}catch(error){failure=error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason});
  expect(calls).toBe(checkpoints);
  expect(decoder.getstate()).toEqual(before);
  expect(()=>decoder.decode(input.slice(1),false,meter)).toThrow(failure as ExecutionLimitError);
  expect(decoder.getstate()).toEqual(before);
});
