import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {Traceback} from "./traceback.js";

const budget=()=>new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});

it("retains frame and instruction identity independently of later frame movement",()=>{
  const meter=budget(),frame={line:20},tail=new Traceback(null,frame,8,12,meter),head=new Traceback(tail,frame,4,10,meter);
  frame.line=99;
  expect(head.frame).toBe(frame);expect(head.next).toBe(tail);expect(head.lastInstruction).toBe(4);
  expect(head.lineNumber(()=>{throw Error("explicit line must not resolve");},meter)).toBe(10);
  expect(Object.isFrozen(head)).toBe(true);
});

it.each([0,-2,1,2147483647])("preserves an explicitly supplied line %s",line=>{
  const meter=budget(),tb=new Traceback(null,{},-1,line,meter);
  expect(tb.lineNumber(()=>{throw Error("must not resolve");},meter)).toBe(line);
});

it("resolves only the -1 sentinel using the saved instruction, not the current frame line",()=>{
  const meter=budget(),frame={line:99},tb=new Traceback(null,frame,4,-1,meter),seen:unknown[]=[];
  expect(tb.lineNumber((value,instruction)=>{seen.push(value,instruction);return 12;},meter)).toBe(12);
  expect(tb.lineNumber(()=>null,meter)).toBeNull();expect(seen).toEqual([frame,4]);
});

it("supports replacing and clearing links without modifying the discarded chain",()=>{
  const meter=budget(),a=new Traceback(null,{},0,1,meter),b=new Traceback(a,{},2,2,meter),c=new Traceback(null,{},4,3,meter);
  b.setNext(c,meter);expect(b.next).toBe(c);expect(a.next).toBeNull();
  b.setNext(null,meter);expect(b.next).toBeNull();expect(c.next).toBeNull();
});

it("rejects direct and indirect cycles atomically",()=>{
  const meter=budget(),a=new Traceback(null,{},0,1,meter),b=new Traceback(a,{},2,2,meter),c=new Traceback(b,{},4,3,meter);
  for(const next of [a,b,c])expect(()=>a.setNext(next,meter)).toThrow("traceback loop detected");
  expect(a.next).toBeNull();expect(b.next).toBe(a);expect(c.next).toBe(b);
});

it("traverses long chains iteratively and preserves shared tails",()=>{
  const meter=budget(),tail=new Traceback(null,{},0,1,meter);
  let chain=tail;
  for(let index=0;index<5000;index++)chain=new Traceback(chain,{},index,index,meter);
  const other=new Traceback(tail,{},0,1,meter);
  other.setNext(chain,meter);expect(other.next).toBe(chain);
  expect(()=>tail.setNext(other,meter)).toThrow("traceback loop detected");expect(tail.next).toBeNull();
});

it("leaves the old link intact if the traversal budget is exhausted",()=>{
  const meter=budget(),old=new Traceback(null,{},0,1,meter),target=new Traceback(old,{},0,1,meter);
  let chain=old;for(let index=0;index<20;index++)chain=new Traceback(chain,{},index,index,meter);
  const limited=new ExecutionBudget({maxSteps:5,maxAllocatedBytes:1000});
  expect(()=>target.setNext(chain,limited)).toThrow(ExecutionLimitError);expect(target.next).toBe(old);
});

it("checks cancellation before resolving a lazy line",()=>{
  const meter=budget(),tb=new Traceback(null,{},0,-1,meter),controller=new AbortController();controller.abort();
  const cancelled=new ExecutionBudget({signal:controller.signal,maxSteps:100,maxAllocatedBytes:1000});
  expect(()=>tb.lineNumber(()=>{throw Error("must not resolve");},cancelled)).toThrow(ExecutionLimitError);
});

it.each([false,true])("checks cancellation after lazy line resolution (throws=%s)",throws=>{
  const meter=budget(),tb=new Traceback(null,{},0,-1,meter),controller=new AbortController();
  const cancelled=new ExecutionBudget({signal:controller.signal,maxSteps:100,maxAllocatedBytes:1000});
  expect(()=>tb.lineNumber(()=>{controller.abort();if(throws)throw Error("resolver failure");return 12;},cancelled)).toThrow(ExecutionLimitError);
});

it("preserves ordinary lazy line resolver failures without caching them",()=>{
  const meter=budget(),tb=new Traceback(null,{},0,-1,meter),failure=Error("resolver failure");
  expect(()=>tb.lineNumber(()=>{throw failure;},meter)).toThrow(failure);
  expect(tb.lineNumber(()=>12,meter)).toBe(12);
});
