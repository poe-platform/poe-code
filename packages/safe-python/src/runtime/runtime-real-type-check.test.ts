import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeValues,type RuntimeValue,type BuiltinInvocationContext} from "./runtime-values.js";
import {RuntimeTypeLayout} from "./runtime-type-layout.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {runtimeRealClassInstance,runtimeRealClassSubclass} from "./runtime-real-type-check.js";

function fixture(){
  const meter=new ExecutionBudget({maxSteps:1000000,maxAllocatedBytes:10000000}),v=new RuntimeValues(meter);
  const dictionary=v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>1n,equal:(a,b)=>a===b},meter));
  const target=v.type(new RuntimeTypeLayout("Target",[],dictionary,meter),"self"),other=v.type(new RuntimeTypeLayout("Other",[],dictionary,meter),"self");
  const invocation:BuiltinInvocationContext={call:()=>v.none,actualType:()=>other,attribute:()=>v.none};
  return {meter,v,target,other,invocation};
}
it.each(["actual","apparent","bases"])("preserves cancellation over failing %s type-check callbacks",operation=>{
  const s=fixture(),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:100000,signal:controller.signal});
  const fail=():never=>{controller.abort();throw Error("callback");};
  if(operation==="actual")s.invocation.actualType=fail;else s.invocation.attribute=fail;
  expect(()=>operation==="bases"?runtimeRealClassSubclass(s.v.none,s.target,meter,s.invocation):runtimeRealClassInstance(s.v.none,s.target,meter,s.invocation)).toThrow(ExecutionLimitError);
});
it("bounds cyclic abstract base graphs without using the host call stack",()=>{
  const s=fixture(),cycle=s.v.tuple([s.v.none]);
  s.invocation.attribute=()=>cycle;
  expect(()=>runtimeRealClassSubclass(s.v.none,s.target,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:10000}),s.invocation)).toThrow(ExecutionLimitError);
});
it("walks deep single-base chains iteratively and short circuits later branches",()=>{
  const s=fixture(),nodes=Array.from({length:10000},(_,index)=>s.v.integer(index)),bases=new Map<RuntimeValue,RuntimeValue>();
  for(let index=0;index<nodes.length;index++)bases.set(nodes[index],s.v.tuple([nodes[index+1]??s.target]));
  bases.set(s.target,s.v.tuple([]));let visited=0;
  s.invocation.attribute=value=>{visited++;const result=bases.get(value);if(result===undefined)throw Error("unexpected branch");return result;};
  expect(runtimeRealClassSubclass(nodes[0],s.target,s.meter,s.invocation)).toBe(true);expect(visited).toBe(10002);
  bases.set(nodes[0],s.v.tuple([s.target,s.v.none]));
  expect(runtimeRealClassSubclass(nodes[0],s.target,s.meter,s.invocation)).toBe(true);
});
