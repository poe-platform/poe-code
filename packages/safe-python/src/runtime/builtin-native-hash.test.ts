import {expect,it,vi} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeHashError} from "./runtime-hash-error.js";
import {PythonRuntimeError} from "./error.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import {runtimeComparison} from "./runtime-comparison.js";
import {callRuntimeMethodDescriptor} from "./runtime-method-descriptor.js";

function fixture(){
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),v=new RuntimeValues(meter);
  const keys={hash:()=>1n,equal:(a:RuntimeValue,b:RuntimeValue)=>runtimeComparison("==",a,b,v,meter).value},registry=new RuntimeTypeRegistry(v,keys,meter);
  const descriptor=registry.noneType().value.namespace.items.lookup(v.string("__hash__"))!.value;
  if(descriptor.kind!=="wrapper_descriptor")throw Error("expected wrapper");
  return {meter,v,descriptor,keywords:v.dictionary(new OrderedKeyMap(keys,meter))};
}

it("uses native hashing rather than independently requesting identity hashes",()=>{
  const {v,meter,descriptor,keywords}=fixture(),nativeHash=vi.fn(()=>29n),identityHash=vi.fn(()=>17n);
  expect(callRuntimeMethodDescriptor(descriptor,[v.none],keywords,meter,{call(){throw Error("unexpected call");},nativeHash,identityHash})).toEqual(v.integer(29));
  expect(nativeHash).toHaveBeenCalledExactlyOnceWith(v.none);expect(identityHash).not.toHaveBeenCalled();
});

it("validates receiver and arguments before consulting the hash policy",()=>{
  const {v,meter,descriptor,keywords}=fixture(),nativeHash=vi.fn(()=>29n),invocation={call(){throw Error("unexpected call");},nativeHash};
  expect(()=>callRuntimeMethodDescriptor(descriptor,[v.integer(1)],keywords,meter,invocation)).toThrow("requires a 'NoneType' object");
  expect(()=>callRuntimeMethodDescriptor(descriptor,[v.none,v.none],keywords,meter,invocation)).toThrow("expected 0 arguments, got 1");
  keywords.items.set(v.string("x"),v.none);
  expect(()=>callRuntimeMethodDescriptor(descriptor,[v.none],keywords,meter,invocation)).toThrow("wrapper __hash__() takes no keyword arguments");
  expect(nativeHash).not.toHaveBeenCalled();
});

it("unwraps the original hash failure without replacing its identity",()=>{
  const {v,meter,descriptor,keywords}=fixture(),failure=new PythonRuntimeError("TypeError","guest hash failed");
  expect.assertions(1);
  try{descriptor.value.invoke(v.none,[],keywords,meter,{call(){throw Error("unexpected call");},nativeHash(){throw new RuntimeHashError("NoneType",failure,meter);}});}
  catch(error){expect(error).toBe(failure);}
});

it.each([false,true])("retains cancellation from native hashing (throws=%s)",throws=>{
  const {v,descriptor,keywords}=fixture(),controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:100000,signal:controller.signal});
  expect(()=>descriptor.value.invoke(v.none,[],keywords,meter,{call(){throw Error("unexpected call");},nativeHash(){controller.abort();if(throws)throw Error("hash failed");return 29n;}})).toThrow(ExecutionLimitError);
});
