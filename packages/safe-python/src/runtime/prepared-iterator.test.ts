import {expect,it} from "vitest";
import {PreparedIterator} from "./prepared-iterator.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";

const budget=()=>new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:10000});
it("advances a prepared iterator without acquisition or exhaustion latching",()=>{
  const source={},stop=new Error("stop");let calls=0;
  const cursor=new PreparedIterator(source,{next(value){expect(value).toBe(source);if(++calls===2)throw stop;return calls;},isStopIteration:error=>error===stop},budget());
  expect(cursor.next()).toEqual({done:false,value:1});
  expect(cursor.next()).toEqual({done:true,value:undefined,exception:{value:stop}});
  expect(cursor.next()).toEqual({done:false,value:3});
});
it("preserves native completion records without reclassifying them",()=>{
  const step={done:true as const,value:undefined,exception:{value:new Error("done")}};
  const cursor=new PreparedIterator(null,{nativeIterator:()=>({next:()=>step}),next(){throw Error("must not call");},isStopIteration(){throw Error("must not classify");}},budget());
  expect(cursor.next()).toBe(step);
});
it("lets cancellation take priority after a failing guest next callback",()=>{
  const controller=new AbortController(),cursor=new PreparedIterator(null,{next(){controller.abort();throw Error("callback");},isStopIteration(){throw Error("must not classify");}},new ExecutionBudget({signal:controller.signal,maxSteps:1000,maxAllocatedBytes:10000}));
  expect(()=>cursor.next()).toThrow(ExecutionLimitError);
});
