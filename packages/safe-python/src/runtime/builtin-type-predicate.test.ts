import {expect,it} from "vitest";
import {ExecutionBudget} from "./execution-budget.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {createTypePredicateBuiltin} from "./builtin-type-predicate.js";

it.each(["isinstance","issubclass"] as const)("validates %s positional arity and rejects keywords before dispatch",name=>{
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000}),v=new RuntimeValues(meter);
  const keywords=v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>1n,equal:(a,b)=>a===b},meter));
  const builtin=createTypePredicateBuiltin(name,v,meter);
  for(const count of [0,1,3])expect(()=>builtin.value.invoke(Array<RuntimeValue>(count).fill(v.none),keywords,meter)).toThrow(`${name} expected 2 arguments, got ${count}`);
  keywords.items.set(v.string("classinfo"),v.none);
  expect(()=>builtin.value.invoke([],keywords,meter)).toThrow(`${name}() takes no keyword arguments`);
});
it.each(["isinstance","issubclass"] as const)("uses the configured %s policy before invocation fallback",name=>{
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000}),v=new RuntimeValues(meter);
  const keywords=v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>1n,equal:(a,b)=>a===b},meter));let calls=0;
  const builtin=createTypePredicateBuiltin(name,v,meter,{lookupSpecial:()=>v.true,call:()=>{calls++;return v.false;}});
  expect(builtin.value.invoke([v.none,v.none],keywords,meter,{call(){throw Error("wrong policy");}})).toBe(v.false);
  expect(calls).toBe(1);
});
