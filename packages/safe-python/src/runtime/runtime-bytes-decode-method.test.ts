import {expect,it} from "vitest";
import {createRuntimeBytesDecodeMethod} from "./runtime-bytes-decode-method.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";

function fixture(signal?:AbortSignal){
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:2000000,signal}),v=new RuntimeValues(meter);
  const keywords=v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>1n,equal:(a,b)=>a===b},meter));
  const context:BuiltinInvocationContext={call(fn,args){if(fn.kind!=="builtin_function_or_method")throw Error("unexpected callable");return fn.value.invoke(args,keywords,meter,context);},isCallable:fn=>fn.kind==="builtin_function_or_method",isStopIteration:()=>false};
  const registry=new RuntimeCodecRegistry(v,meter),source=v.bytes(new Uint8Array([120])),result=v.string("decoded");
  const method=createRuntimeBytesDecodeMethod(source,v,meter,(bytes,encoding,errors,_meter,invocation)=>{
    expect(bytes).toBe(source.value);
    return registry.transform("decode",source,encoding,errors,invocation!,true);
  });
  return {v,meter,keywords,registry,source,result,method,context};
}

it("uses the supplied registry, cached codec identity and unchecked consumed counts",()=>{
  const {v,meter,keywords,registry,source,result,method,context}=fixture();let searches=0,decodes=0;
  const decoder=v.builtinFunction({name:"decode",invoke(args){expect(args).toEqual([source]);decodes++;return v.tuple([result,v.none]);}});
  registry.register(v.builtinFunction({name:"search",invoke(){searches++;return v.tuple([v.none,decoder,v.none,v.none]);}}),context);
  for(let index=0;index<2;index++)expect(method.value.invoke([v.string("custom")],keywords,meter,context)).toBe(result);
  expect(searches).toBe(1);expect(decodes).toBe(2);
});

it("validates registry decoder output after tuple extraction",()=>{
  const {v,meter,keywords,registry,source,method,context}=fixture();
  const decoder=v.builtinFunction({name:"decode",invoke(){return v.tuple([source,v.none]);}});
  registry.register(v.builtinFunction({name:"search",invoke(){return v.tuple([v.none,decoder,v.none,v.none]);}}),context);
  expect(()=>method.value.invoke([v.string("custom")],keywords,meter,context)).toThrow("'custom' decoder returned 'bytes' instead of 'str'; use codecs.decode() to decode to arbitrary types");
});

it("validates names but skips the codec for an empty receiver",()=>{
  const {v,meter,keywords,context}=fixture();let calls=0;
  const method=createRuntimeBytesDecodeMethod(v.bytes(new Uint8Array()),v,meter,()=>{calls++;throw Error("must not look up codec");});
  expect(method.value.invoke([v.string("missing")],keywords,meter,context)).toEqual(v.string(""));
  expect(()=>method.value.invoke([v.string("bad\0name")],keywords,meter,context)).toThrow("embedded null character");
  expect(calls).toBe(0);
});

it.each([false,true])("cancellation dominates decoder return and failure (throws=%s)",throws=>{
  const controller=new AbortController(),{v,meter,keywords,context,source}=fixture(controller.signal);
  const method=createRuntimeBytesDecodeMethod(source,v,meter,()=>{controller.abort();if(throws)throw Error("decoder failure");return v.string("ignored");});
  expect(()=>method.value.invoke([],keywords,meter,context)).toThrow(ExecutionLimitError);
});
