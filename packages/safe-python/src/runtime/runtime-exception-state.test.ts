import { expect,it } from "vitest";
import { ExecutionBudget,ExecutionLimitError } from "./execution-budget.js";
import { RuntimeValues,type InstanceValue,type RuntimeValue } from "./runtime-values.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { RuntimeExceptionState,runtimeExceptionPayload } from "./runtime-exception-state.js";
import { HandledExceptionState } from "./exception-state.js";

it("chains native exception contexts without changing explicit cause or suppression",()=>{
  const meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000}),v=new RuntimeValues(meter);
  const namespace=v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>1n,equal:(a,b)=>a===b},meter));
  const owner=v.type(new RuntimeTypeLayout("BaseException",[],namespace,meter,{objectLayout:false}),"self");
  const a=v.instance(owner,undefined,new RuntimeExceptionState(v.tuple([]),meter)),b=v.instance(owner,undefined,new RuntimeExceptionState(v.tuple([]),meter));
  const first=runtimeExceptionPayload(a)!,second=runtimeExceptionPayload(b)!;
  first.assignContext(b,meter);second.assignCause(a,meter);
  const handled=new HandledExceptionState<InstanceValue>(),restore=handled.enter(a);
  handled.chain(b,{get:value=>runtimeExceptionPayload(value)!.context,set:(value,context)=>runtimeExceptionPayload(value)!.assignContext(context,meter)},meter);
  expect(first.context).toBe(null);expect(second.context).toBe(a);expect(second.cause).toBe(a);expect(second.suppressContext).toBe(true);
  restore();expect(handled.active).toBe(null);
});

it("does not partially assign cause or suppression when the execution meter rejects a write",()=>{
  const meter=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:10000}),v=new RuntimeValues(meter),state=new RuntimeExceptionState(v.tuple([]),meter);
  expect(()=>state.assignCause(null,new ExecutionBudget({maxSteps:0,maxAllocatedBytes:100}))).toThrow(ExecutionLimitError);
  expect(state.cause).toBe(null);expect(state.suppressContext).toBe(false);
});
