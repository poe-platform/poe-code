import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {PythonEncodeError} from "./encode-error.js";
import {gb2312Codec} from "./gb2312-codec.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeExceptionExecution,RuntimeRaisedException} from "./runtime-exception-execution.js";
import {runtimeExceptionPayload} from "./runtime-exception-state.js";
import {RuntimeMultibyteRecovery} from "./runtime-multibyte-recovery.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";

it.each(["return","ordinary failure","fatal"] as const)("strict multibyte chaining preserves %s and cancellation at the service boundary",outcome=>{
  for(const cancel of [false,true]){
    const controller=new AbortController();
    const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
    const values=new RuntimeValues(meter),registry=new RuntimeCodecRegistry(values,meter);
    const types=new RuntimeTypeRegistry(values,{hash:()=>0n,equal:(a:RuntimeValue,b:RuntimeValue)=>a===b},meter);
    const exceptions=new RuntimeExceptionExecution(types,values,meter);
    const source=values.string("\ud800"),fault=new PythonEncodeError("gb2312",source.value,0,1,"illegal multibyte sequence");
    const failure=new Error("chaining failed"),fatal=new ExecutionLimitError("allocation");
    let calls=0,prepared:unknown,raised:unknown;
    const context:BuiltinInvocationContext={
      call(){throw new Error("strict must bypass registered handlers");},
      prepareException(error,retained){prepared=exceptions.prepare(error,retained);return prepared;},
      chainException(error){
        calls++;
        raised=exceptions.chain(error);
        if(cancel)controller.abort();
        if(outcome==="ordinary failure")throw failure;
        if(outcome==="fatal")throw fatal;
        return raised;
      }
    };
    const recovery=new RuntimeMultibyteRecovery(registry,source,context);
    let caught:unknown;
    try{recovery.recover(fault,"strict",()=>{throw new Error("strict must not encode replacement text");});}
    catch(error){caught=error;}
    expect(calls).toBe(1);
    expect(prepared).toBeInstanceOf(RuntimeRaisedException);
    expect((raised as RuntimeRaisedException).value).toBe((prepared as RuntimeRaisedException).value);
    if(outcome==="fatal")expect(caught).toBe(fatal);
    else if(cancel)expect(caught).toMatchObject({reason:"cancelled"});
    else expect(caught).toBe(outcome==="return"?raised:failure);
    if(cancel){
      expect(()=>recovery.recover(fault,"strict")).toThrow(ExecutionLimitError);
      expect(calls).toBe(1);
    }
  }
});

it.each(["unencodable","host failure","fatal","success"] as const)("multibyte replacement %s respects cancellation before exception preparation",outcome=>{
  for(const cancel of [false,true]){
    const controller=new AbortController();
    const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
    const values=new RuntimeValues(meter),registry=new RuntimeCodecRegistry(values,meter);
    const types=new RuntimeTypeRegistry(values,{hash:()=>0n,equal:(a:RuntimeValue,b:RuntimeValue)=>a===b},meter);
    const exceptions=new RuntimeExceptionExecution(types,values,meter);
    const source=values.string("\ud800"),replacement=values.string(outcome==="unencodable"?"\ud801":"?");
    const fault=new PythonEncodeError("gb2312",source.value,0,1,"illegal multibyte sequence");
    const result=values.tuple([replacement,values.integer(-1)]);
    const hostFailure=new Error("replacement failed"),fatal=new ExecutionLimitError("allocation");
    let preparations=0,handlers=0,encoders=0;
    const context:BuiltinInvocationContext={
      isCallable:()=>true,
      call(){handlers++;return result;},
      prepareException(error,retained){preparations++;return exceptions.prepare(error,retained);}
    };
    registry.registerError("custom",values.cell({}),context);
    const recovery=new RuntimeMultibyteRecovery(registry,source,context);
    const run=()=>recovery.recover(fault,"custom",text=>{
      encoders++;
      try {
        if(outcome==="host failure")throw hostFailure;
        if(outcome==="fatal")throw fatal;
        return gb2312Codec.encode(text,"strict",meter);
      }finally{if(cancel)controller.abort();}
    });
    let caught:unknown;
    try {
      expect(run()).toEqual({replacement:Uint8Array.of(63),position:-1n});
      expect(outcome).toBe("success");expect(cancel).toBe(false);
    }catch(error){caught=error;}
    if(outcome==="fatal")expect(caught).toBe(fatal);
    else if(cancel){
      expect(caught).toBeInstanceOf(ExecutionLimitError);
      expect(caught).toMatchObject({reason:"cancelled"});
      for(let retry=0;retry<2;retry++){
        let repeated:unknown;try{run();}catch(error){repeated=error;}
        expect(repeated).toBe(caught);
      }
    }else if(outcome==="host failure")expect(caught).toBe(hostFailure);
    else if(outcome==="unencodable"){
      expect(caught).toBeInstanceOf(RuntimeRaisedException);
      const state=runtimeExceptionPayload((caught as RuntimeRaisedException).value)!;
      expect(state.member("object",meter)).toBe(replacement);
      expect(state.member("start",meter)).toEqual(values.integer(0));
      expect(state.member("end",meter)).toEqual(values.integer(1));
    }else expect(caught).toBeUndefined();
    expect(preparations).toBe(!cancel&&outcome==="unencodable"?2:1);
    expect(handlers).toBe(1);expect(encoders).toBe(1);
  }
});
