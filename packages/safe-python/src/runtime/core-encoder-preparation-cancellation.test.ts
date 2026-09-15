import {expect,it} from "vitest";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {encodeRuntimeCoreText} from "./runtime-core-text-codec.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeExceptionExecution} from "./runtime-exception-execution.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";

const cases=(["ascii","latin_1"] as const).flatMap(codec=>
  (["return","ordinary failure","guest failure","fatal"] as const).flatMap(outcome=>
    [false,true].map(cancel=>({codec,outcome,cancel}))));

it.each(cases)("core $codec native fault preparation: $outcome, cancellation=$cancel",({codec,outcome,cancel})=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  const values=new RuntimeValues(meter),registry=new RuntimeCodecRegistry(values,meter);
  const types=new RuntimeTypeRegistry(values,{hash:()=>0n,equal:(a:RuntimeValue,b:RuntimeValue)=>a===b},meter);
  const exceptions=new RuntimeExceptionExecution(types,values,meter),source=values.string("\u0100");
  const ordinary=new Error("preparation failed"),fatal=new ExecutionLimitError("allocation");
  const guest=exceptions.prepare(new PythonRuntimeError("ValueError","preparation failed"));
  let preparations=0,prepared:unknown,caught:unknown;
  const context:BuiltinInvocationContext={
    call(){throw new Error("strict native encoder must not invoke a callback");},
    prepareException(error,retained){
      preparations++;
      expect(retained?.unicodeObject).toBe(source);
      prepared=exceptions.prepare(error,retained);
      if(cancel)controller.abort();
      if(outcome==="ordinary failure")throw ordinary;
      if(outcome==="guest failure")throw guest;
      if(outcome==="fatal")throw fatal;
      return prepared;
    }
  };
  const run=()=>encodeRuntimeCoreText(codec,source,"strict",registry,context);
  try{run();}catch(error){caught=error;}
  expect(preparations).toBe(1);
  if(outcome==="fatal")expect(caught).toBe(fatal);
  else if(cancel)expect(caught).toMatchObject({reason:"cancelled"});
  else expect(caught).toBe(outcome==="return"?prepared:outcome==="guest failure"?guest:ordinary);
  if(cancel){
    expect(run).toThrow(ExecutionLimitError);
    expect(preparations).toBe(1);
  }
});
