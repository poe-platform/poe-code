import {expect,it} from "vitest";
import {PythonDecodeError} from "./decode-error.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeCodecRecovery} from "./runtime-codec-recovery.js";
import {RuntimeExceptionExecution} from "./runtime-exception-execution.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";

const cases=(["encode","decode"] as const).flatMap(operation=>
  (["return","ordinary failure","guest failure","fatal"] as const).flatMap(outcome=>
    [false,true].map(cancel=>({operation,outcome,cancel}))));

it.each(cases)("codec $operation preparation: $outcome, cancellation=$cancel",({operation,outcome,cancel})=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  const values=new RuntimeValues(meter),registry=new RuntimeCodecRegistry(values,meter);
  const types=new RuntimeTypeRegistry(values,{hash:()=>0n,equal:(a:RuntimeValue,b:RuntimeValue)=>a===b},meter);
  const exceptions=new RuntimeExceptionExecution(types,values,meter);
  const text=values.string("\ud800"),bytes=values.bytes(Uint8Array.of(255));
  const source=operation==="encode"?text:bytes;
  const fault=operation==="encode"
    ?new PythonEncodeError("utf-8",text.value,0,1,"surrogates not allowed")
    :new PythonDecodeError("utf-8",Uint8Array.of(255),0,1,"invalid start byte");
  const result=values.tuple([values.string("?"),values.integer(-1)]);
  const failure=new Error("preparation failed"),fatal=new ExecutionLimitError("allocation");
  const guest=exceptions.prepare(new PythonRuntimeError("ValueError","guest preparation failed"));
  let preparations=0,handlers=0,caught:unknown;
  const context:BuiltinInvocationContext={
    isCallable:()=>true,
    isException:(error,name)=>exceptions.matches(error,name),
    call(){handlers++;return result;},
    prepareException(error,retained){
      preparations++;
      const prepared=exceptions.prepare(error,retained);
      if(cancel)controller.abort();
      if(outcome==="ordinary failure")throw failure;
      if(outcome==="guest failure")throw guest;
      if(outcome==="fatal")throw fatal;
      return prepared;
    }
  };
  registry.registerError("custom",values.cell({}),context);
  const recovery=new RuntimeCodecRecovery(registry,"custom",source,context);
  const run=()=>fault instanceof PythonEncodeError?recovery.encode(fault):recovery.decode(fault);
  let recovered:ReturnType<typeof run>|undefined;
  try{recovered=run();}catch(error){caught=error;}
  expect(preparations).toBe(1);
  expect(handlers).toBe(!cancel&&outcome==="return"?1:0);
  if(outcome==="fatal")expect(caught).toBe(fatal);
  else if(cancel)expect(caught).toMatchObject({reason:"cancelled"});
  else if(outcome==="ordinary failure")expect(caught).toBe(failure);
  else if(outcome==="guest failure")expect(caught).toBe(guest);
  else{
    expect(caught).toBeUndefined();
    expect(recovered?.position).toBe(0);
    expect([...recovered!.replacement]).toEqual([63]);
    if(operation==="decode")expect(recovered?.input).toEqual(Uint8Array.of(255));
  }
  if(cancel){
    expect(run).toThrow(ExecutionLimitError);
    expect(preparations).toBe(1);
    expect(handlers).toBe(0);
  }
});
