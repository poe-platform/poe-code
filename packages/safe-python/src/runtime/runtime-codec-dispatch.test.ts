import {expect,it} from "vitest";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {runtimeComparison} from "./runtime-comparison.js";
import {RuntimeValues,type RuntimeValue,type BuiltinInvocationContext} from "./runtime-values.js";

function fixture(signal?:AbortSignal){
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal}),v=new RuntimeValues(meter);
  const keys={hash:()=>0n,equal:(a:RuntimeValue,b:RuntimeValue)=>runtimeComparison("==",a,b,v,meter).value};
  const keywords=v.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(keys,meter));
  const context:BuiltinInvocationContext={
    call:(fn,args)=>{if(fn.kind!=="builtin_function_or_method")throw new PythonRuntimeError("TypeError","'NoneType' object is not callable");return fn.value.invoke(args,keywords,meter,context);},
    isCallable:fn=>fn.kind==="builtin_function_or_method",isStopIteration:()=>false
  };
  const fn=(invoke:(args:readonly RuntimeValue[])=>RuntimeValue)=>v.builtinFunction({name:"codec",invoke});
  const registry=new RuntimeCodecRegistry(v,meter);
  const install=(...items:RuntimeValue[])=>{const codec=v.tuple(items);registry.register(fn(()=>codec),context);return codec;};
  return {meter,v,context,fn,registry,install,keys};
}

it("checks cancellation even when unregister has an empty search path",()=>{
  const controller=new AbortController(),{registry,v}=fixture(controller.signal);
  controller.abort();
  expect(()=>registry.unregister(v.none)).toThrow(ExecutionLimitError);
});

it.each(["encode","decode"] as const)("%s preserves result identity and ignores the consumed entry",operation=>{
  const {v,fn,registry,context,install}=fixture(),source=v.cell({}),result=v.list([v.true]);
  const callback=fn(args=>{expect(args).toEqual([source]);return v.tuple([result,v.cell({})]);});
  install(callback,callback,v.none,v.none);
  expect(registry.transform(operation,source,"custom",undefined,context)).toBe(result);
});

it.each(["encode","decode"] as const)("%s passes supplied errors without normalization",operation=>{
  const {v,fn,registry,context,install}=fixture(),source=v.none;
  const callback=fn(args=>{expect(args).toEqual([source,v.string("CaSe")]);return v.tuple([v.true,v.none]);});
  install(callback,callback,v.none,v.none);
  expect(registry.transform(operation,source,"custom","CaSe",context)).toBe(v.true);
});

it.each(["encode","decode"] as const)("%s validates tuple shape without annotating the validation error",operation=>{
  const {v,fn,registry,context,install}=fixture();let result:RuntimeValue=v.none;
  const callback=fn(()=>result);install(callback,callback,v.none,v.none);
  for(result of [v.none,v.list([v.none,v.none]),v.tuple([]),v.tuple([v.none]),v.tuple([v.none,v.none,v.none])]){
    try{registry.transform(operation,v.none,"custom",undefined,context);expect.fail("expected tuple validation");}
    catch(error){expect(error).toBeInstanceOf(PythonRuntimeError);expect(error).toMatchObject({name:"TypeError",message:operation==="encode"?"encoder must return a tuple (object, integer)":"decoder must return a tuple (object,integer)",notes:undefined});}
  }
});

it.each(["encode","decode"] as const)("%s retains guest failure identity and adds the original codec spelling note",operation=>{
  const {v,fn,registry,context,install,meter}=fixture(),error=new PythonRuntimeError("ValueError","guest failure");
  error.addNote("original",meter);
  const callback=fn(()=>{throw error;});install(callback,callback,v.none,v.none);
  expect(()=>registry.transform(operation,v.none,"CuStOm",undefined,context)).toThrow(error);
  expect(error.notes).toEqual(["original",`${operation==="encode"?"encoding":"decoding"} with 'CuStOm' codec failed`]);
});

it("routes retained guest exceptions through the interpreter note protocol",()=>{
  const {v,fn,registry,context,install}=fixture(),error={guest:true},notes:string[]=[];
  const callback=fn(()=>{throw error;});install(callback,callback,v.none,v.none);
  context.isException=value=>value===error;
  context.addExceptionNote=(value,build)=>{expect(value).toBe(error);notes.push(build());return value;};
  expect(()=>registry.transform("decode",v.none,"custom",undefined,context)).toThrow();
  expect(notes).toEqual(["decoding with 'custom' codec failed"]);
});

it("does not annotate lookup failures or host failures",()=>{
  const {v,fn,registry,context}=fixture(),error=new PythonRuntimeError("LookupError","search"),host=new Error("host");
  const search=fn(()=>{throw error;});registry.register(search,context);
  expect(()=>registry.transform("encode",v.none,"custom",undefined,context)).toThrow(error);expect(error.notes).toBeUndefined();
  registry.unregister(search);
  const callback=fn(()=>{throw host;});registry.register(fn(()=>v.tuple([callback,callback,v.none,v.none])),context);
  let noted=false;context.addExceptionNote=()=>{noted=true;return host;};
  expect(()=>registry.transform("decode",v.none,"custom",undefined,context)).toThrow(host);expect(noted).toBe(false);
});

it.each(["encode","decode"] as const)("%s validates supplied error names before lookup",operation=>{
  const {v,fn,registry,context}=fixture();let calls=0;
  registry.register(fn(()=>{calls++;return v.none;}),context);
  for(const errors of ["bad\0name","\ud800"]){expect(()=>registry.transform(operation,v.none,"custom",errors,context)).toThrow(errors.includes("\0")?"embedded null character":"surrogates not allowed");}
  expect(calls).toBe(0);
});

it.each(["incrementalencoder","incrementaldecoder"] as const)("constructs %s using live attributes and omitted/supplied errors",attribute=>{
  const {v,fn,registry,context,install}=fixture(),codec=install(v.none,v.none,v.none,v.none),result=v.cell({}),seen:RuntimeValue[][]=[];
  context.attribute=(object,name)=>{expect(object).toBe(codec);expect(name).toBe(attribute);return fn(args=>{seen.push([...args]);return result;});};
  expect(registry.incremental(attribute,"custom",undefined,context)).toBe(result);
  expect(registry.incremental(attribute,"custom","",context)).toBe(result);
  expect(seen).toEqual([[],[v.string("")]]);
});

it("accepts tuple subclasses for search and transform results without invoking overrides",()=>{
  const {v,fn,registry,context,keys,meter}=fixture(),types=new RuntimeTypeRegistry(v,keys,meter),result=v.cell({});
  const subtype=types.tupleType();
  const callback=fn(()=>v.instance(subtype,undefined,v.tuple([result,v.none])));
  const info=v.instance(subtype,undefined,v.tuple([callback,callback,v.none,v.none]));
  registry.register(fn(()=>info),context);
  context.attribute=()=>{throw Error("must use native tuple storage");};
  expect(registry.transform("encode",v.none,"custom",undefined,context)).toBe(result);
});

it("text lookup accepts exact tuples without attribute or truth callbacks",()=>{
  const {v,registry,context,install}=fixture(),info=install(v.none,v.none,v.none,v.none);
  context.attribute=()=>{throw Error("exact tuple has no codec metadata");};
  context.truth=()=>{throw Error("must not truth-test exact tuple");};
  expect(registry.lookupText("custom","codecs.encode()",context)).toBe(info);
});

it.each([false,true])("text lookup checks live subtype metadata on cached info (text=%s)",text=>{
  const {v,fn,registry,context,keys,meter}=fixture(),types=new RuntimeTypeRegistry(v,keys,meter);
  const info=v.instance(types.tupleType(),undefined,v.tuple([v.none,v.none,v.none,v.none])),marker=v.cell({});let reads=0,truths=0;
  registry.register(fn(()=>info),context);
  context.attribute=(object,name)=>{expect(object).toBe(info);expect(name).toBe("_is_text_encoding");reads++;return marker;};
  context.truth=value=>{expect(value).toBe(marker);truths++;return text;};
  for(let i=0;i<2;i++){
    if(text)expect(registry.lookupText("CuStOm","codecs.decode()",context)).toBe(info);
    else expect(()=>registry.lookupText("CuStOm","codecs.decode()",context)).toThrow("'CuStOm' is not a text encoding; use codecs.decode() to handle arbitrary codecs");
  }
  expect(reads).toBe(2);expect(truths).toBe(2);
});

it("text lookup suppresses only AttributeError for missing metadata",()=>{
  const {v,fn,registry,context,keys,meter}=fixture(),types=new RuntimeTypeRegistry(v,keys,meter);
  const info=v.instance(types.tupleType(),undefined,v.tuple([v.none,v.none,v.none,v.none]));
  registry.register(fn(()=>info),context);
  context.attribute=()=>{throw new PythonRuntimeError("AttributeError","missing");};
  expect(registry.lookupText("custom",undefined,context)).toBe(info);
  const failure=new PythonRuntimeError("ValueError","descriptor");context.attribute=()=>{throw failure;};
  expect(()=>registry.lookupText("custom",undefined,context)).toThrow(failure);
  expect(failure.notes).toBeUndefined();
});

it("text dispatch rejects nontext codecs before invoking the encoder",()=>{
  const {v,fn,registry,context,keys,meter}=fixture(),types=new RuntimeTypeRegistry(v,keys,meter);
  const callback=fn(()=>{throw Error("must not call encoder");});
  const info=v.instance(types.tupleType(),undefined,v.tuple([callback,callback,v.none,v.none]));
  registry.register(fn(()=>info),context);context.attribute=()=>v.false;context.truth=()=>false;
  expect(()=>registry.transform("encode",v.none,"custom",undefined,context,true)).toThrow("'custom' is not a text encoding; use codecs.encode() to handle arbitrary codecs");
});

it("text lookup honors cancellation from a suppressed attribute failure",()=>{
  const controller=new AbortController(),{v,fn,registry,context,keys,meter}=fixture(controller.signal),types=new RuntimeTypeRegistry(v,keys,meter);
  const info=v.instance(types.tupleType(),undefined,v.tuple([v.none,v.none,v.none,v.none]));registry.register(fn(()=>info),context);
  context.attribute=()=>{controller.abort();throw new PythonRuntimeError("AttributeError","missing");};
  expect(()=>registry.lookupText("custom",undefined,context)).toThrow(ExecutionLimitError);
});

it.each([["a".repeat(401),"a".repeat(400)],["é".repeat(401),"é".repeat(200)],["a".repeat(399)+"💥","a".repeat(399)]])("bounds nontext diagnostics to complete UTF-8 characters: %s",(encoding,expected)=>{
  const {v,fn,registry,context,keys,meter}=fixture(),types=new RuntimeTypeRegistry(v,keys,meter);
  const info=v.instance(types.tupleType(),undefined,v.tuple([v.none,v.none,v.none,v.none]));registry.register(fn(()=>info),context);
  context.attribute=()=>v.false;context.truth=()=>false;
  expect(()=>registry.lookupText(encoding,undefined,context)).toThrow(`'${expected}' is not a text encoding`);
});

it.each(["incrementalencoder","incrementaldecoder"] as const)("does not annotate %s factory or descriptor failures",attribute=>{
  const {v,fn,registry,context,install}=fixture(),failure=new PythonRuntimeError("ValueError","factory");
  install(v.none,v.none,v.none,v.none);
  context.attribute=()=>{throw failure;};
  expect(()=>registry.incremental(attribute,"custom",undefined,context)).toThrow(failure);
  context.attribute=()=>fn(()=>{throw failure;});
  expect(()=>registry.incremental(attribute,"custom",undefined,context)).toThrow(failure);
  expect(failure.notes).toBeUndefined();
});

it.each(["reader","writer"] as const)("does not annotate stream %s factory failures",direction=>{
  const {v,fn,registry,context,install}=fixture(),failure=new PythonRuntimeError("ValueError","factory"),factory=fn(()=>{throw failure;});
  install(v.none,v.none,factory,factory);
  expect(()=>registry.stream(direction,v.none,"custom",undefined,context)).toThrow(failure);
  expect(failure.notes).toBeUndefined();
});

it.each(["reader","writer"] as const)("constructs stream %s from the matching tuple slot",direction=>{
  const {v,fn,registry,context,install}=fixture(),stream=v.cell({}),result=v.cell({}),seen:RuntimeValue[][]=[];
  const factory=fn(args=>{seen.push([...args]);return result;}),unused=fn(()=>{throw Error("wrong stream slot");});
  install(v.none,v.none,direction==="reader"?factory:unused,direction==="writer"?factory:unused);
  expect(registry.stream(direction,stream,"custom",undefined,context)).toBe(result);
  expect(registry.stream(direction,stream,"custom","replace",context)).toBe(result);
  expect(seen).toEqual([[stream],[stream,v.string("replace")]]);
});

it.each(["transform","incremental","stream"] as const)("%s cancellation dominates callback return and failure",operation=>{
  for(const throws of [false,true]){
    const controller=new AbortController(),{v,fn,registry,context,install}=fixture(controller.signal),error=new PythonRuntimeError("ValueError","guest");
    const callback=fn(()=>{controller.abort();if(throws)throw error;return v.tuple([v.none,v.none]);});install(callback,callback,callback,callback);
    context.attribute=()=>callback;
    const run=()=>operation==="transform"?registry.transform("encode",v.none,"custom",undefined,context):operation==="incremental"?registry.incremental("incrementaldecoder","custom",undefined,context):registry.stream("reader",v.none,"custom",undefined,context);
    expect(run).toThrow(ExecutionLimitError);expect(error.notes).toBeUndefined();
  }
});
