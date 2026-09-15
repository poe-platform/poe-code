import {expect,it} from "vitest";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeValues,type BuiltinInvocationContext} from "./runtime-values.js";

it.each(["search","error"] as const)("%s registration observes callability-service cancellation and preserves failures",kind=>{
  for(const cancel of [false,true])for(const outcome of ["callable","not-callable","throw"] as const){
    const controller=new AbortController();
    const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
    const values=new RuntimeValues(meter);let initializations=0,calls=0;
    const registry=new RuntimeCodecRegistry(values,meter,()=>{initializations++;});
    const handler=values.cell({}),failure=new PythonRuntimeError("ValueError","callability failed");
    const context:BuiltinInvocationContext={
      call(){throw Error("unexpected guest invocation");},
      isCallable(value){
        expect(value).toBe(handler);calls++;
        if(cancel)controller.abort();
        if(outcome==="throw")throw failure;
        return outcome==="callable";
      }
    };
    const run=()=>kind==="search"?registry.register(handler,context):registry.registerError("custom",handler,context);
    if(cancel){
      expect(run).toThrow(ExecutionLimitError);
      expect(run).toThrow(ExecutionLimitError);
      expect(calls).toBe(1);
      expect(initializations).toBe(0);
    }else if(outcome==="throw"){
      let actual:unknown;try{run();}catch(error){actual=error;}
      expect(actual).toBe(failure);
      expect(initializations).toBe(0);
    }else if(outcome==="not-callable"){
      expect(run).toThrow(kind==="search"?"argument must be callable":"handler must be callable");
      expect(initializations).toBe(0);
    }else{
      run();expect(initializations).toBe(1);
      if(kind==="search")expect(registry.hasSearchFunctions).toBe(true);
      else expect(registry.lookupError("custom")).toBe(handler);
    }
  }
});

it.each(["search","error"] as const)("%s registration preserves a fatal callability failure by identity",kind=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
  const values=new RuntimeValues(meter),registry=new RuntimeCodecRegistry(values,meter);
  const failure=new ExecutionLimitError("allocation");
  const context:BuiltinInvocationContext={call(){throw Error("unexpected guest invocation");},isCallable(){throw failure;}};
  let actual:unknown;
  try{if(kind==="search")registry.register(values.none,context);else registry.registerError("custom",values.none,context);}catch(error){actual=error;}
  expect(actual).toBe(failure);
});
