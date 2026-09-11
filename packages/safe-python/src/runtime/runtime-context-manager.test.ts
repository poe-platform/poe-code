import {expect,it,vi} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {prepareRuntimeContextManager} from "./runtime-context-manager.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";

function fixture(){
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}),values=new RuntimeValues(meter);
  const call=vi.fn(()=>values.none),lookupSpecial=vi.fn((_source:RuntimeValue,name:string)=>values.string(name));
  const invocation:BuiltinInvocationContext={call,lookupSpecial,actualType(){throw Error("unexpected type lookup");},hasSpecial:()=>false};
  return {controller,meter,values,invocation,call,lookupSpecial};
}

it("caches exit and enter and passes three None values on normal exit",()=>{
  const s=fixture(),manager=prepareRuntimeContextManager(s.values.none,s.invocation,s.values,s.meter);
  expect(s.lookupSpecial.mock.calls.map(args=>args[1])).toEqual(["__exit__","__enter__"]);
  manager.enter();manager.exit(null);
  expect(s.call.mock.calls).toHaveLength(2);
  expect(s.call.mock.calls[1]).toEqual([s.values.string("__exit__"),[s.values.none,s.values.none,s.values.none]]);
});

it.each(["enter","exit"] as const)("does not invoke %s after cancellation",operation=>{
  const s=fixture(),manager=prepareRuntimeContextManager(s.values.none,s.invocation,s.values,s.meter);s.controller.abort();
  expect(()=>operation==="enter"?manager.enter():manager.exit(null)).toThrow(ExecutionLimitError);
  expect(s.call).not.toHaveBeenCalled();
});

it.each(["lookup","enter","exit"] as const)("preserves cancellation after successful and failed %s callbacks",operation=>{
  for(const throws of [false,true]){
    const s=fixture(),failure=()=>{s.controller.abort();if(throws)throw Error("callback failure");return s.values.none;};
    if(operation==="lookup")s.invocation.lookupSpecial=failure;
    const run=()=>{
      const manager=prepareRuntimeContextManager(s.values.none,s.invocation,s.values,s.meter);
      s.invocation.call=failure;
      return operation==="enter"?manager.enter():manager.exit(null);
    };
    expect(run).toThrow(ExecutionLimitError);
  }
});

it("rejects opaque host errors without passing them to guest exit",()=>{
  const s=fixture(),manager=prepareRuntimeContextManager(s.values.none,s.invocation,s.values,s.meter);
  expect(()=>manager.exit({error:Error("host")})).toThrow("context manager exit requires a native guest exception");
  expect(s.call).not.toHaveBeenCalled();
});
