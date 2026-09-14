import {createRuntimeNativeBuffers} from "./runtime-native-buffers.js";
import {expect,it,vi} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import type {ImmutableBytes} from "./immutable-bytes.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {createRuntimeStringDecoder} from "./runtime-string-decoding.js";
import {createRuntimeTextDecoder} from "./runtime-text-decoding.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";

function fixture(withFallback=true){
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:2000000,signal:controller.signal});
  const values=new RuntimeValues(meter),registry=new RuntimeCodecRegistry(values,meter);
  const callbacks=new Map<RuntimeValue,(args:readonly RuntimeValue[])=>RuntimeValue>();
  const fn=(callback:(args:readonly RuntimeValue[])=>RuntimeValue)=>{
    const value=values.builtinFunction({name:"callback",invoke:()=>values.none});
    callbacks.set(value,callback);return value;
  };
  // The external buffer provider is mocked; the registry and text adapters are real.
  const view=values.cell({}),createReadOnlyView=vi.fn((_bytes:ImmutableBytes):RuntimeValue=>view);
  const context:BuiltinInvocationContext={codecs:registry,
    call:(value,args)=>callbacks.get(value)!(args),isCallable:value=>callbacks.has(value),
    buffers:createRuntimeNativeBuffers(meter,{acquireSimple:()=>undefined,createReadOnlyView})};
  const fallback=vi.fn(()=>values.string("fallback"));
  const decode=createRuntimeStringDecoder(createRuntimeTextDecoder(values,withFallback?fallback:undefined),values);
  return {controller,meter,values,registry,fn,view,createReadOnlyView,context,fallback,decode};
}

it.each(["custom-decoder","cp819","utf-8-sig","utf-16-le","utf-7"])("dispatches %s through the invocation registry before any native or supplied fallback",encoding=>{
  for(const withFallback of [false,true]){
    const {meter,values,registry,fn,view,createReadOnlyView,context,fallback,decode}=fixture(withFallback);
    const seen:RuntimeValue[][]=[];
    const decoder=vi.fn((args:readonly RuntimeValue[])=>{
      seen.push([...args]);
      return values.tuple([values.string("registered"),values.none]);
    });
    registry.register(fn(()=>values.tuple([values.none,fn(decoder),values.none,values.none])),context);
    const source=values.bytes(Uint8Array.of(65,66));
    expect(decode(source,encoding,undefined,meter,context)).toEqual(values.string("registered"));
    expect(seen).toEqual([[view]]);
    expect([...createReadOnlyView.mock.calls[0][0]]).toEqual([65,66]);
    expect(fallback).not.toHaveBeenCalled();
  }
});

it("retains successful lookup identity until unregister clears it, while allocating each input view",()=>{
  const {meter,values,registry,fn,createReadOnlyView,context,decode}=fixture();
  let searches=0;
  const source=values.bytes(Uint8Array.of(65));
  const search=fn(()=>{
    searches++;
    return values.tuple([values.none,fn(args=>values.tuple([args[1],values.none])),values.none,values.none]);
  });
  registry.register(search,context);
  for(const name of ["Cache-Decoder","CACHE DECODER"]){
    expect(decode(source,name,"chosen",meter,context)).toEqual(values.string("chosen"));
  }
  expect(searches).toBe(1);
  registry.unregister(search);registry.register(search,context);
  expect(decode(source,"cache_decoder","next",meter,context)).toEqual(values.string("next"));
  expect(searches).toBe(2);expect(createReadOnlyView).toHaveBeenCalledTimes(3);
});

it.each(["utf8","ascii","latin1","utf16","utf32"])("preserves the native %s shortcut without allocating a view",encoding=>{
  const {meter,values,registry,fn,createReadOnlyView,context,fallback,decode}=fixture();
  registry.register(fn(()=>{throw Error("unexpected search");}),context);
  const bytes=encoding==="utf16"?[65,0]:encoding==="utf32"?[65,0,0,0]:[65];
  expect(decode(values.bytes(Uint8Array.from(bytes)),encoding,undefined,meter,context)).toEqual(values.string("A"));
  expect(createReadOnlyView).not.toHaveBeenCalled();expect(fallback).not.toHaveBeenCalled();
});

it("skips views, search and error lookup for empty text conversion",()=>{
  const {meter,values,registry,fn,createReadOnlyView,context,decode}=fixture();
  registry.register(fn(()=>{throw Error("unexpected search");}),context);
  expect(decode(values.bytes(new Uint8Array()),"custom","missing",meter,context)).toEqual(values.string(""));
  expect(createReadOnlyView).not.toHaveBeenCalled();
});

it.each(["view","search","decode"] as const)("preserves %s failures and annotates only decoder failures",stage=>{
  const {meter,values,registry,fn,createReadOnlyView,context,decode}=fixture();
  const failure=new PythonRuntimeError("ValueError","guest failure");
  if(stage==="view")createReadOnlyView.mockImplementation(()=>{throw failure;});
  registry.register(fn(()=>{
    if(stage==="search")throw failure;
    return values.tuple([values.none,fn(()=>{throw failure;}),values.none,values.none]);
  }),context);
  expect(()=>decode(values.bytes(Uint8Array.of(65)),"custom",undefined,meter,context)).toThrow(failure);
  expect(failure.notes).toEqual(stage==="decode"?["decoding with 'custom' codec failed"]:undefined);
});

it.each(["view","search","decode"] as const)("makes cancellation terminal at the %s boundary",stage=>{
  for(const throws of [false,true]){
    const {controller,meter,values,registry,fn,createReadOnlyView,context,decode}=fixture();
    const cancel=()=>{controller.abort();if(throws)throw new PythonRuntimeError("ValueError","service failure");};
    if(stage==="view")createReadOnlyView.mockImplementation(()=>{cancel();return values.none;});
    const result=values.tuple([values.string("decoded"),values.none]);
    const info=values.tuple([values.none,fn(()=>{if(stage==="decode")cancel();return result;}),values.none,values.none]);
    registry.register(fn(()=>{
      if(stage==="search")cancel();
      return info;
    }),context);
    expect(()=>decode(values.bytes(Uint8Array.of(65)),"custom",undefined,meter,context)).toThrow(ExecutionLimitError);
    expect(()=>meter.checkpoint()).toThrow(ExecutionLimitError);
  }
});

it.each(["tuple","text"] as const)("validates registry %s results without annotating validation errors",kind=>{
  const {meter,values,registry,fn,context,decode}=fixture();
  const addExceptionNote=vi.fn();context.addExceptionNote=addExceptionNote;
  registry.register(fn(()=>values.tuple([values.none,fn(()=>kind==="tuple"?values.none:values.tuple([values.none,values.cell({})])),values.none,values.none])),context);
  expect(()=>decode(values.bytes(Uint8Array.of(65)),"custom",undefined,meter,context)).toThrow(
    kind==="tuple"?"decoder must return a tuple (object,integer)":"'custom' decoder returned 'NoneType' instead of 'str'; use codecs.decode() to decode to arbitrary types"
  );
  expect(addExceptionNote).not.toHaveBeenCalled();
});
