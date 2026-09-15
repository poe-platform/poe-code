import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {createStandardCodecErrors} from "./runtime-codec-errors.js";
import {RuntimeExceptionExecution,RuntimeRaisedException} from "./runtime-exception-execution.js";
import {RuntimeExceptionState} from "./runtime-exception-state.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";

function fixture(){
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  const values=new RuntimeValues(meter);
  const keys={hash:()=>0n,equal:(left:RuntimeValue,right:RuntimeValue)=>left===right};
  const types=new RuntimeTypeRegistry(values,keys,meter);
  const exceptions=new RuntimeExceptionExecution(types,values,meter);
  const original=values.instance(types.exceptionType("ValueError"),undefined,new RuntimeExceptionState(values.tuple([]),meter));
  const keywords=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(keys,meter));
  return {controller,meter,values,exceptions,original,keywords,handlers:createStandardCodecErrors(values,meter)};
}

it.each(["ignore","replace","xmlcharrefreplace","backslashreplace","namereplace","surrogateescape","surrogatepass"])(
  "%s observes classification cancellation before another service callback",name=>{
    for(const stage of [1,2,3])for(const outcome of ["false","true","throw","raised","fatal"] as const){
      const {controller,meter,exceptions,original,keywords,handlers}=fixture();
      const handler=handlers.get(name)!;
      if(handler.kind!=="builtin_function_or_method")throw Error("expected native handler");
      const failure=new Error("classification failed"),raised=new RuntimeRaisedException(original,meter),fatal=new ExecutionLimitError("allocation");
      let classifications=0,chains=0;
      const context:BuiltinInvocationContext={
        call(){throw Error("unexpected guest invocation");},
        isException(error){
          expect(error).toBeInstanceOf(RuntimeRaisedException);
          if(++classifications!==stage)return false;
          controller.abort();
          if(outcome==="throw")throw failure;
          if(outcome==="raised")throw raised;
          if(outcome==="fatal")throw fatal;
          return outcome==="true";
        },
        chainException(value){chains++;return exceptions.chain(value);}
      };
      const run=()=>handler.value.invoke([original],keywords,meter,context);
      let caught:unknown;try{run();}catch(error){caught=error;}
      expect(caught).toBeInstanceOf(ExecutionLimitError);
      if(outcome==="fatal")expect(caught).toBe(fatal);
      expect(classifications).toBe(stage);
      expect(chains).toBe(0);
      const calls=classifications;
      expect(run).toThrow(ExecutionLimitError);
      expect(classifications).toBe(calls);
    }
  }
);

it("standard handlers preserve ordinary classification failures and fatal identity",()=>{
  for(const kind of ["host","guest","fatal"] as const){
    const {meter,exceptions,original,keywords,handlers}=fixture();
    const failure=kind==="host"?new Error("classification failed"):kind==="guest"?new RuntimeRaisedException(original,meter):new ExecutionLimitError("steps");
    const handler=handlers.get("ignore")!;
    if(handler.kind!=="builtin_function_or_method")throw Error("expected native handler");
    let chains=0;
    const context:BuiltinInvocationContext={
      call(){throw Error("unexpected guest invocation");},isException(){throw failure;},
      chainException(value){chains++;return exceptions.chain(value);}
    };
    let caught:unknown;try{handler.value.invoke([original],keywords,meter,context);}catch(error){caught=error;}
    if(kind==="guest"){
      expect(caught).toBeInstanceOf(RuntimeRaisedException);
      expect((caught as RuntimeRaisedException).value).toBe(original);
    }else expect(caught).toBe(failure);
    expect(chains).toBe(kind==="guest"?1:0);
  }
});

it("strict handler chaining observes cancellation on return and failure",()=>{
  for(const cancel of [false,true])for(const outcome of ["return","throw","fatal"] as const){
    const {controller,meter,original,keywords,handlers}=fixture();
    const handler=handlers.get("strict")!;
    if(handler.kind!=="builtin_function_or_method")throw Error("expected native handler");
    const raised=new RuntimeRaisedException(original,meter),failure=new Error("chaining failed"),fatal=new ExecutionLimitError("steps");
    let chains=0;
    const context:BuiltinInvocationContext={
      call(){throw Error("unexpected guest invocation");},
      chainException(value){
        expect(value).toBe(original);chains++;
        if(cancel)controller.abort();
        if(outcome==="throw")throw failure;
        if(outcome==="fatal")throw fatal;
        return raised;
      }
    };
    const run=()=>handler.value.invoke([original],keywords,meter,context);
    let caught:unknown;try{run();}catch(error){caught=error;}
    if(outcome==="fatal")expect(caught).toBe(fatal);
    else if(cancel){expect(caught).toBeInstanceOf(ExecutionLimitError);expect(run).toThrow(ExecutionLimitError);}
    else expect(caught).toBe(outcome==="throw"?failure:raised);
    expect(chains).toBe(1);
  }
});
