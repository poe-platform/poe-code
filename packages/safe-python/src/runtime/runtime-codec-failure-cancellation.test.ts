import {expect,it} from "vitest";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {throwRuntimeCodecFailure} from "./runtime-codec-failure.js";
import {RuntimeExceptionExecution} from "./runtime-exception-execution.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";

it.each(["classification","annotation"] as const)("codec failure observes %s service cancellation",phase=>{
  for(const outcome of ["return","throw","fatal"] as const)for(const cancel of [false,true]){
    const controller=new AbortController();
    const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
    const values=new RuntimeValues(meter);
    const types=new RuntimeTypeRegistry(values,{hash:()=>0n,equal:(a:RuntimeValue,b:RuntimeValue)=>a===b},meter);
    const exceptions=new RuntimeExceptionExecution(types,values,meter);
    const original=exceptions.prepare(new PythonRuntimeError("ValueError","decoder failed"));
    const serviceFailure=new Error("service failed"),fatal=new ExecutionLimitError("allocation");
    let classifications=0,annotations=0;
    const finish=()=>{
      if(cancel)controller.abort();
      if(outcome==="fatal")throw fatal;
      if(outcome==="throw")throw serviceFailure;
    };
    const context:BuiltinInvocationContext={
      call(){throw Error("unexpected guest call");},
      isException(error,name){
        classifications++;
        expect(error).toBe(original);expect(name).toBe("BaseException");
        if(phase==="classification")finish();
        return true;
      },
      addExceptionNote(error,note){
        annotations++;
        expect(error).toBe(original);
        expect(note()).toBe("decoding with 'custom' codec failed");
        if(phase==="annotation")finish();
        return original;
      }
    };
    let caught:unknown;
    try{throwRuntimeCodecFailure(original,"decode","custom",meter,context);}catch(error){caught=error;}
    if(outcome==="fatal")expect(caught).toBe(fatal);
    else if(cancel){
      expect(caught).toBeInstanceOf(ExecutionLimitError);
      expect(caught).toMatchObject({reason:"cancelled"});
      let repeated:unknown;
      try{throwRuntimeCodecFailure(original,"decode","custom",meter,context);}catch(error){repeated=error;}
      expect(repeated).toBe(caught);
    }else expect(caught).toBe(outcome==="throw"?serviceFailure:original);
    expect(classifications).toBe(1);
    expect(annotations).toBe(phase==="annotation"||outcome==="return"&&!cancel?1:0);
  }
});
