import {expect,it,vi} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {prepareRuntimeAsyncContextManager} from "./runtime-async-context-manager.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";

function fixture(){
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal}),values=new RuntimeValues(meter);
  const call=vi.fn(()=>values.none),lookupSpecial=vi.fn((_source:RuntimeValue,name:string)=>values.string(name));
  const invocation:BuiltinInvocationContext={call,lookupSpecial,actualType(){throw Error("unexpected type lookup");},hasSpecial:()=>false};
  return {controller,meter,values,invocation,call,lookupSpecial};
}

it("binds exit before enter but delays calls until their cursors advance",()=>{
  const s=fixture(),awaitValue=vi.fn(function*(value:RuntimeValue,method:"aenter"|"aexit"){expect(value).toBe(s.values.none);yield s.values.string(method);return s.values.true;});
  const manager=prepareRuntimeAsyncContextManager(s.values.none,s.invocation,awaitValue,s.values,s.meter);
  expect(s.lookupSpecial.mock.calls.map(args=>args[1])).toEqual(["__aexit__","__aenter__"]);
  const enter=manager.enter(),exit=manager.exit(null);
  expect(s.call).not.toHaveBeenCalled();
  expect(enter.next(s.values.none)).toEqual({done:false,value:s.values.string("aenter")});
  expect(enter.next(s.values.none)).toEqual({done:true,value:s.values.true});
  expect(exit.next(s.values.none)).toEqual({done:false,value:s.values.string("aexit")});
  expect(exit.next(s.values.none)).toEqual({done:true,value:s.values.true});
  expect(s.call.mock.calls[1]).toEqual([s.values.string("__aexit__"),[s.values.none,s.values.none,s.values.none]]);
});

it.each(["enter","exit"] as const)("rejects cancelled async %s before guest calls",operation=>{
  const s=fixture(),awaitValue=vi.fn(function*(){yield s.values.none;return s.values.none;}),manager=prepareRuntimeAsyncContextManager(s.values.none,s.invocation,awaitValue,s.values,s.meter);
  const cursor=operation==="enter"?manager.enter():manager.exit(null);s.controller.abort();
  expect(()=>cursor.next(s.values.none)).toThrow(ExecutionLimitError);
  expect(s.call).not.toHaveBeenCalled();expect(awaitValue).not.toHaveBeenCalled();
});

it.each(["enter","exit"] as const)("preserves cancellation over async %s completion and failure",operation=>{
  for(const throws of [false,true]){
    const s=fixture(),awaitValue=function*(){yield s.values.none;s.controller.abort();if(throws)throw Error("await failure");return s.values.none;};
    const manager=prepareRuntimeAsyncContextManager(s.values.none,s.invocation,awaitValue,s.values,s.meter),cursor=operation==="enter"?manager.enter():manager.exit(null);
    expect(cursor.next(s.values.none).done).toBe(false);
    expect(()=>cursor.next(s.values.none)).toThrow(ExecutionLimitError);
  }
});
