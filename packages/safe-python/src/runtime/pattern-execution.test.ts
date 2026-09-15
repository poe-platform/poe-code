import {expect,it} from "vitest";
import {parsePattern} from "../patterns.js";
import type {Pattern} from "../pattern-ast.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {matchPattern,type PatternContext} from "./pattern-execution.js";

function fixture(){
  const names=new Map<string,unknown>(),events:unknown[]=[];
  const context:PatternContext<unknown>={
    evaluate(node){if(node.kind!=="literal")throw Error("expected literal");return node.value;},
    equal(a,b){events.push(b);return a===b;},identical:(a,b)=>a===b,
    store(name,value){names.set(name,value);}
  };
  return {names,events,context,meter:new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000})};
}
it("retries nested alternatives and publishes only successful captures in order",()=>{
  const state=fixture();
  expect(matchPattern(parsePattern("((1 as x)|(2 as x)) as y"),2n,state.context,state.meter)).toBe(true);
  expect(state.events).toEqual([1n,2n]);expect([...state.names]).toEqual([["x",2n],["y",2n]]);
});
it("keeps unmatched and wildcard patterns from publishing captures",()=>{
  const state=fixture();
  expect(matchPattern(parsePattern("(1|2) as x"),3n,state.context,state.meter)).toBe(false);
  expect(matchPattern(parsePattern("_"),null,state.context,state.meter)).toBe(true);
  expect(state.names.size).toBe(0);
});
it("does not treat a comparison error as a failed alternative",()=>{
  const state=fixture(),failure=Error("equality");let calls=0;
  state.context.equal=()=>{calls++;throw failure;};
  expect(()=>matchPattern(parsePattern("1|2"),2n,state.context,state.meter)).toThrow(failure);
  expect(calls).toBe(1);
});
it("discards failed sequence-alternative captures without closing extraction iterators",()=>{
  const state=fixture(),writes:string[]=[];let closed=0;
  state.context.store=(name,value)=>{writes.push(name);state.names.set(name,value);};
  state.context.sequence=(pattern,subject)=>{
    if(!Array.isArray(subject))return undefined;
    let index=0;
    return {next(){return index===pattern.items.length?{done:true,value:undefined}:{done:false,value:{pattern:pattern.items[index],value:subject[index++]}};},return(){closed++;return {done:true,value:undefined};}};
  };
  expect(matchPattern(parsePattern("([x,1]|[x,2])"),[7n,2n],state.context,state.meter)).toBe(true);
  expect(writes).toEqual(["x"]);expect(state.names.get("x")).toBe(7n);expect(closed).toBe(0);
});
it("checks cancellation when sequence extraction throws before captures publish",()=>{
  const state=fixture(),controller=new AbortController();
  state.context.sequence=()=>({next(){controller.abort();throw Error("extract");}});
  expect(()=>matchPattern(parsePattern("[x]"),[],state.context,new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:100000,signal:controller.signal}))).toThrow(ExecutionLimitError);
  expect(state.names.size).toBe(0);
});
it.each(["prepare","next"])("preserves cancellation during class extraction %s before publishing captures",operation=>{
  const state=fixture(),controller=new AbortController();
  const fail=():never=>{controller.abort();throw Error("class extraction");};
  state.context.class=()=>operation==="prepare"?fail():{next:fail};
  expect(()=>matchPattern(parsePattern("C(x)"),{},state.context,new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:100000,signal:controller.signal}))).toThrow(ExecutionLimitError);
  expect(state.names.size).toBe(0);
});
it.each(["position","evaluate","equal","identical","store"] as const)("preserves cancellation over %s callback faults",operation=>{
  const state=fixture(),controller=new AbortController();
  state.context[operation]=()=>{controller.abort();throw Error("callback");};
  const pattern=parsePattern(operation==="store"?"x":operation==="identical"?"None":"1");
  expect(()=>matchPattern(pattern,1n,state.context,new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:100000,signal:controller.signal}))).toThrow(ExecutionLimitError);
});
it("uses bounded heap work rather than the host call stack for nested patterns",()=>{
  const state=fixture(),leaf=parsePattern("_"),name={name:"x",spelling:"x",start:leaf.start,end:leaf.end};
  let pattern:Pattern=leaf;
  for(let i=0;i<1000;i++)pattern={kind:"as",pattern,name:{...name,name:"x"+i},start:leaf.start,end:leaf.end};
  expect(matchPattern(pattern,7,state.context,state.meter)).toBe(true);expect(state.names.size).toBe(1000);
  expect(()=>matchPattern(pattern,7,state.context,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:100000}))).toThrow(ExecutionLimitError);
  expect(()=>matchPattern(pattern,7,state.context,new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000}))).toThrow(ExecutionLimitError);
});
