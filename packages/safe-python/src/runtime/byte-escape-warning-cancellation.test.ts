import {expect,it} from "vitest";
import {decodeByteEscape} from "./byte-escape.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";

const inputs = [
  {name:"unknown escape", bytes:[92,113], marker:113},
  {name:"overflowing octal", bytes:[92,55,55,55], marker:511}
];

it.each(inputs.flatMap(row=>[false,true].map(throws=>({...row,throws}))))("keeps $name warning cancellation terminal when throws=$throws",({bytes,marker,throws})=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:10000,signal:controller.signal});
  const failure=new PythonRuntimeError("ValueError","warning service failed");
  let warnings=0,terminal:unknown;
  const run=()=>decodeByteEscape(Uint8Array.from(bytes),"strict",meter,(_message,actual,position)=>{
    warnings++;
    expect([actual,position]).toEqual([marker,0]);
    controller.abort();
    if(throws)throw failure;
  });
  try{run();}catch(error){terminal=error;}
  expect(terminal).toBeInstanceOf(ExecutionLimitError);
  expect(terminal).toMatchObject({reason:"cancelled"});
  expect(warnings).toBe(1);
  try{run();expect.fail("terminated decoder resumed");}catch(error){expect(error).toBe(terminal);}
  expect(warnings).toBe(1);
});

it.each(inputs)("preserves $name warning failure identity without cancellation",({bytes})=>{
  const meter=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:10000});
  const failure=new PythonRuntimeError("ValueError","warning service failed");
  let caught:unknown;
  try{decodeByteEscape(Uint8Array.from(bytes),"strict",meter,()=>{throw failure;});}catch(error){caught=error;}
  expect(caught).toBe(failure);
  expect([...decodeByteEscape(Uint8Array.of(65),"strict",meter,()=>{throw failure;})]).toEqual([65]);
});

it("does not replace a fatal warning failure with a later cancellation",()=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:10000,signal:controller.signal});
  const failure=new ExecutionLimitError("allocation");
  let caught:unknown;
  try{decodeByteEscape(Uint8Array.of(92,113),"strict",meter,()=>{
    controller.abort();
    throw failure;
  });}catch(error){caught=error;}
  expect(caught).toBe(failure);
});
