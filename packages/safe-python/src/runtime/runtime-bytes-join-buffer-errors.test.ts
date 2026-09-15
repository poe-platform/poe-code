import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {runtimeComparison} from "./runtime-comparison.js";
import {RuntimeExceptionExecution,RuntimeRaisedException} from "./runtime-exception-execution.js";
import {RuntimeExceptionState} from "./runtime-exception-state.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";
import {createRuntimeBytesJoinMethod} from "./runtime-bytes-join-method.js";

function fixture(){
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:2000000}),values=new RuntimeValues(meter);
  const keys={hash:()=>1n,equal:(a:RuntimeValue,b:RuntimeValue)=>runtimeComparison("==",a,b,values,meter).value};
  const registry=new RuntimeTypeRegistry(values,keys,meter),exceptions=new RuntimeExceptionExecution(registry,values,meter);
  const invocation:BuiltinInvocationContext={
    call(){throw Error("unexpected guest call");},
    isStopIteration:error=>exceptions.matches(error,"StopIteration"),
    isException:exceptions.matches.bind(exceptions)
  };
  const keywords=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(keys,meter));
  return {meter,values,registry,invocation,keywords};
}

// The external CPython 3.14.7 probe uses a guest __buffer__ raising each
// exception. Only the exporter service is mocked here; exception allocation,
// inheritance classification and join execute their real runtime components.
it.each(["ValueError","TypeError","MemoryError","KeyboardInterrupt","SystemExit"] as const)("replaces a guest %s from buffer acquisition and releases prior exports",name=>{
  const {meter,values,registry,invocation,keywords}=fixture();
  const failure=new RuntimeRaisedException(values.instance(registry.exceptionType(name),undefined,new RuntimeExceptionState(values.tuple([values.string("export failed")]),meter)),meter);
  const first=values.list([]),bad=values.list([]),events:string[]=[];
  const method=createRuntimeBytesJoinMethod(values.bytes(Uint8Array.of(44)),values,meter,undefined,{
    typeName:()=>"Export",
    acquireSimple(value){
      if(value===bad){events.push("fail");throw failure;}
      expect(value).toBe(first);events.push("acquire");
      return {byteLength:1,copy(){events.push("copy");throw Error("must not copy after failed acquisition");},release(){events.push("release");}};
    }
  });
  expect(()=>method.value.invoke([values.list([first,bad])],keywords,meter,invocation)).toThrow(new PythonRuntimeError("TypeError","sequence item 1: expected a bytes-like object, Export found"));
  expect(events).toEqual(["acquire","fail","release"]);
});

it.each([new ExecutionLimitError("cancelled"),new Error("host failure")])("does not rewrite fatal buffer failures: %s",failure=>{
  const {meter,values,invocation,keywords}=fixture();
  const method=createRuntimeBytesJoinMethod(values.bytes(new Uint8Array()),values,meter,undefined,{acquireSimple(){throw failure;}});
  let observed:unknown;
  try{method.value.invoke([values.list([values.none])],keywords,meter,invocation);}catch(error){observed=error;}
  expect(observed).toBe(failure);
});
