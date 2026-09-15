import {expect,it} from "vitest";
import {PythonEncodeError} from "./encode-error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeCodecRecovery} from "./runtime-codec-recovery.js";
import {RuntimeExceptionExecution,RuntimeRaisedException} from "./runtime-exception-execution.js";
import {runtimeExceptionPayload} from "./runtime-exception-state.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";

it.each(["return","throw","fatal"] as const)("replacement rejection observes chaining cancellation on %s",outcome=>{
  for(const cancel of [false,true]){
    const controller=new AbortController();
    const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
    const values=new RuntimeValues(meter),registry=new RuntimeCodecRegistry(values,meter);
    const types=new RuntimeTypeRegistry(values,{hash:()=>0n,equal:(a:RuntimeValue,b:RuntimeValue)=>a===b},meter);
    const exceptions=new RuntimeExceptionExecution(types,values,meter);
    const source=values.string("A\ud800B"),replacement=values.string("\ud801");
    const fault=new PythonEncodeError("utf-8",source.value,1,2,"surrogates not allowed");
    const failure=new Error("chaining failed"),fatal=new ExecutionLimitError("allocation");
    let chains=0;
    const context:BuiltinInvocationContext={
      isCallable:()=>true,
      prepareException:(error,retained)=>exceptions.prepare(error,retained),
      call(_handler,args){
        const state=runtimeExceptionPayload(args[0])!;
        state.assignMember("start",values.integer(0),meter);
        state.assignMember("end",values.integer(3),meter);
        state.assignMember("reason",values.string("changed"),meter);
        return values.tuple([replacement,values.integer(-1)]);
      },
      chainException(value){
        chains++;
        const state=runtimeExceptionPayload(value)!;
        expect(state.member("object",meter)).toBe(source);
        expect(state.member("start",meter)).toEqual(values.integer(1));
        expect(state.member("end",meter)).toEqual(values.integer(2));
        expect(state.member("reason",meter)).toEqual(values.string("surrogates not allowed"));
        const raised=exceptions.chain(value);
        if(cancel)controller.abort();
        if(outcome==="fatal")throw fatal;
        if(outcome==="throw")throw failure;
        return raised;
      }
    };
    registry.registerError("custom",values.cell({}),context);
    const result=new RuntimeCodecRecovery(registry,"custom",source,context).encode(fault);
    expect(result.position).toBe(2);
    expect(result.replacement).toBe(replacement.value);
    const reject=result.rejectReplacement!;
    let caught:unknown;try{reject();}catch(error){caught=error;}
    if(outcome==="fatal")expect(caught).toBe(fatal);
    else if(cancel){
      expect(caught).toBeInstanceOf(ExecutionLimitError);
      expect(caught).toMatchObject({reason:"cancelled"});
      let repeated:unknown;try{reject();}catch(error){repeated=error;}
      expect(repeated).toBe(caught);
    }else if(outcome==="throw")expect(caught).toBe(failure);
    else{
      expect(caught).toBeInstanceOf(RuntimeRaisedException);
      expect((caught as RuntimeRaisedException).value).toBe((result.failure as RuntimeRaisedException).value);
    }
    expect(chains).toBe(1);
  }
});
