import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeValues,type BuiltinInvocationContext} from "./runtime-values.js";

const operations=["register","unregister","registerError","lookup","hasSearchFunctions"] as const;

it.each(operations.flatMap(operation=>[false,true].map(throws=>({operation,throws}))))("$operation observes cancellation when lazy initialization ends (throws=$throws)",({operation,throws})=>{
    const controller=new AbortController();
    const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
    const values=new RuntimeValues(meter),failure=new PythonRuntimeError("ValueError","initialization failed");
    const search=values.builtinFunction({name:"search",invoke:()=>values.none});
    const context:BuiltinInvocationContext={call:()=>values.none,isCallable:()=>true};
    let initializations=0;
    const registry=new RuntimeCodecRegistry(values,meter,()=>{
      initializations++;controller.abort();if(throws)throw failure;
    });
    const run=()=>{
      switch(operation){
        case "register":return registry.register(search,context);
        case "unregister":return registry.unregister(search);
        case "registerError":return registry.registerError("custom",search,context);
        case "lookup":return registry.lookup("custom",context);
        case "hasSearchFunctions":return registry.hasSearchFunctions;
      }
    };
    expect(run,`throws=${throws}`).toThrow(ExecutionLimitError);
    expect(initializations).toBe(1);
    expect(run).toThrow(ExecutionLimitError);
    expect(initializations).toBe(1);
    expect(failure.notes).toBeUndefined();
});

it("retries failed initialization while preserving failure identity and recursive registrations",()=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
  const values=new RuntimeValues(meter),failure=new PythonRuntimeError("ImportError","initialization failed");
  const codec=values.tuple([values.none,values.none,values.none,values.none]);
  const search=values.builtinFunction({name:"search",invoke:()=>codec});
  const context:BuiltinInvocationContext={call:()=>codec,isCallable:()=>true};
  let initializations=0;
  const registry=new RuntimeCodecRegistry(values,meter,()=>{
    initializations++;
    if(initializations===1)throw failure;
    registry.register(search,context);
    expect(registry.hasSearchFunctions).toBe(true);
  });
  expect(()=>registry.lookup("custom",context)).toThrow(failure);
  expect(registry.lookup("custom",context)).toBe(codec);
  expect(initializations).toBe(2);
  registry.unregister(search);
  expect(registry.hasSearchFunctions).toBe(false);
  expect(initializations).toBe(2);
});

it("preserves a terminal initialization failure without another checkpoint",()=>{
  let terminal=false;
  const meter={checkpoint:()=>{if(terminal)throw new Error("checkpoint after terminal failure");}};
  const values=new RuntimeValues(meter),failure=new ExecutionLimitError("steps");
  const registry=new RuntimeCodecRegistry(values,meter,()=>{terminal=true;throw failure;});
  expect(()=>registry.hasSearchFunctions).toThrow(failure);
});
