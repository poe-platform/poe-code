import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeValues,type RuntimeValue,type BuiltinInvocationContext} from "./runtime-values.js";
import {RuntimeTypeLayout} from "./runtime-type-layout.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {runtimeTypePredicate} from "./runtime-type-predicate.js";

function fixture(){
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:10000000}),v=new RuntimeValues(meter);
  const namespace=v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>1n,equal:(a,b)=>a===b},meter));
  const type=v.type(new RuntimeTypeLayout("C",[],namespace,meter),"self");
  const invocation:BuiltinInvocationContext={objectType:type,actualType:()=>type,call:()=>v.true,lookupSpecial:()=>v.true,attribute:()=>v.none};
  return {meter,v,type,invocation};
}
it("does not enumerate tuple alternatives beyond a successful first class",()=>{
  const s=fixture(),classes=s.v.tuple([s.type,...Array<RuntimeValue>(10000).fill(s.v.none)]);
  expect(runtimeTypePredicate("isinstance",s.v.none,classes,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000}),s.invocation)).toBe(true);
});
it.each(["lookupSpecial","call","truth","actualType"] as const)("preserves cancellation over %s callback failures",operation=>{
  const s=fixture(),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:10000,signal:controller.signal});
  s.invocation[operation]=()=>{controller.abort();throw Error("callback");};
  expect(()=>runtimeTypePredicate("isinstance",s.v.none,operation==="actualType"?s.type:s.v.none,meter,s.invocation)).toThrow(ExecutionLimitError);
});
it("bounds deep tuple traversal with execution and allocation limits",()=>{
  const s=fixture();let nested:RuntimeValue=s.type;
  for(let i=0;i<10000;i++)nested=s.v.tuple([nested]);
  expect(runtimeTypePredicate("isinstance",s.v.none,nested,s.meter,s.invocation)).toBe(true);
  expect(()=>runtimeTypePredicate("isinstance",s.v.none,nested,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:100000}),s.invocation)).toThrow(ExecutionLimitError);
  expect(()=>runtimeTypePredicate("isinstance",s.v.none,nested,new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:100}),s.invocation)).toThrow(ExecutionLimitError);
});
