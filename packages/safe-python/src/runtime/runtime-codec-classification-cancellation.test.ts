import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";

it.each(["encode","decode"] as const)("%s stops before annotating a failure when classification cancels",operation=>{
  for(const cancel of [false,true])for(const outcome of ["guest","host","throw","fatal"] as const){
    const controller=new AbortController();
    const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
    const values=new RuntimeValues(meter),registry=new RuntimeCodecRegistry(values,meter);
    const failure=new Error("codec failed"),classificationFailure=new Error("classification failed"),fatal=new ExecutionLimitError("allocation");
    const search=values.cell({}),callback=values.cell({}),codec=values.tuple([callback,callback,values.none,values.none]);
    let classifications=0,notes=0,calls=0;
    const context:BuiltinInvocationContext={
      isCallable:()=>true,
      call(fn){calls++;if(fn===search)return codec;throw failure;},
      isException(error,name){
        expect(error).toBe(failure);expect(name).toBe("BaseException");classifications++;
        if(cancel)controller.abort();
        if(outcome==="fatal")throw fatal;
        if(outcome==="throw")throw classificationFailure;
        return outcome==="guest";
      },
      addExceptionNote(error,build){notes++;expect(build()).toBe(`${operation==="encode"?"encoding":"decoding"} with 'custom' codec failed`);return error;}
    };
    registry.register(search,context);
    const run=()=>registry.transform(operation,values.none,"custom",undefined,context);
    let caught:unknown;try{run();}catch(error){caught=error;}
    if(outcome==="fatal")expect(caught).toBe(fatal);
    else if(cancel){
      expect(caught).toBeInstanceOf(ExecutionLimitError);
      let repeated:unknown;try{run();}catch(error){repeated=error;}
      expect(repeated).toBe(caught);
    }else expect(caught).toBe(outcome==="throw"?classificationFailure:failure);
    expect(classifications).toBe(1);expect(calls).toBe(2);
    expect(notes).toBe(!cancel&&outcome==="guest"?1:0);
  }
});

it("text metadata cancellation stops before exception classification",()=>{
  for(const cancel of [false,true])for(const missing of [false,true]){
    const controller=new AbortController();
    const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
    const values=new RuntimeValues(meter),registry=new RuntimeCodecRegistry(values,meter);
    const keys={hash:()=>0n,equal:(a:RuntimeValue,b:RuntimeValue)=>a===b};
    const types=new RuntimeTypeRegistry(values,keys,meter);
    const info=values.instance(types.tupleType(),undefined,values.tuple([values.none,values.none,values.none,values.none]));
    const failure=new Error("descriptor failed");let classifications=0,attributes=0;
    const context:BuiltinInvocationContext={
      isCallable:()=>true,call:()=>info,
      attribute(){attributes++;if(cancel)controller.abort();throw failure;},
      isException(error,name){expect(error).toBe(failure);expect(name).toBe("AttributeError");classifications++;return missing;}
    };
    registry.register(values.builtinFunction({name:"search",invoke:()=>info}),context);
    const run=()=>registry.lookupText("custom",undefined,context);
    if(cancel){expect(run).toThrow(ExecutionLimitError);expect(run).toThrow(ExecutionLimitError);}
    else if(missing)expect(run()).toBe(info);
    else expect(run).toThrow(failure);
    expect(attributes).toBe(1);expect(classifications).toBe(cancel?0:1);
  }
});
