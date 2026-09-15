import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeBytesIterator} from "./runtime-bytes-iterator.js";
import {RuntimeValues} from "./runtime-values.js";

it("charges cursor and result storage before advancing or releasing the source",()=>{
  const budget=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000});
  let fail=false;
  const meter={checkpoint(steps=1,bytes=0){if(fail&&bytes>0)throw new ExecutionLimitError("allocation");budget.checkpoint(steps,bytes);}};
  const values=new RuntimeValues(meter),source=values.bytes(Uint8Array.of(65));
  fail=true;
  expect(()=>new RuntimeBytesIterator(source,values,meter)).toThrow(ExecutionLimitError);
  fail=false;
  const cursor=new RuntimeBytesIterator(source,values,meter);
  fail=true;
  expect(()=>cursor.next()).toThrow(ExecutionLimitError);
  fail=false;
  expect(cursor.state()).toEqual({source,index:0});
  expect(cursor.next()).toEqual({done:false,value:values.integer(65)});
  fail=true;
  expect(()=>cursor.next()).toThrow(ExecutionLimitError);
  fail=false;
  expect(cursor.state()).toEqual({source,index:1});
  expect(cursor.next().done).toBe(true);
  expect(cursor.state()).toEqual({source:undefined,index:1});
});

it.each(["next","lengthHint","state","setState"] as const)("observes latched cancellation for %s",operation=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
  const values=new RuntimeValues(meter),zero=values.integer(0),cursor=new RuntimeBytesIterator(values.bytes(Uint8Array.of(65)),values,meter);
  controller.abort();
  expect(()=>operation==="setState"?cursor.setState(zero):cursor[operation]()).toThrow(ExecutionLimitError);
  expect(()=>meter.checkpoint(0,0)).toThrow(ExecutionLimitError);
});
