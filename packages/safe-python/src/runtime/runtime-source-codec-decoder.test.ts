import {createRuntimeNativeBuffers} from "./runtime-native-buffers.js";
import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {createRuntimeSourceCodecDecoder} from "./runtime-source-codec-decoder.js";
import {RuntimeValues,type RuntimeValue,type BuiltinInvocationContext} from "./runtime-values.js";
import {decodeByteSource} from "./byte-source-decoding.js";
import {createRuntimeCompilation} from "./runtime-compilation.js";
import {RuntimeCodePrograms} from "./runtime-code-programs.js";
import type {ImmutableBytes} from "./immutable-bytes.js";
import {PythonSyntaxError} from "../source.js";

function fixture(){
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal}),v=new RuntimeValues(meter);
  const callbacks=new Map<RuntimeValue,(args:readonly RuntimeValue[])=>RuntimeValue>();
  const fn=(body:(args:readonly RuntimeValue[])=>RuntimeValue)=>{
    const value=v.builtinFunction({name:"callback",invoke:()=>v.none});callbacks.set(value,body);return value;
  };
  const registry=new RuntimeCodecRegistry(v,meter),views:RuntimeValue[]=[],copies:number[][]=[];
  const context:BuiltinInvocationContext={codecs:registry,isCallable:value=>callbacks.has(value),isStopIteration:()=>false,
    call:(value,args)=>callbacks.get(value)!(args),
    buffers:createRuntimeNativeBuffers(meter,{acquireSimple:()=>undefined,createReadOnlyView(bytes){
      copies.push([...bytes]);const view=v.cell({});views.push(view);return view;
    }})};
  return {controller,meter,v,fn,registry,context,views,copies};
}

it("dispatches translated source through the interpreter registry with one buffer argument",()=>{
  const {meter,v,fn,registry,context,views,copies}=fixture(),seen:RuntimeValue[]=[];
  registry.register(fn(args=>{
    seen.push(args[0]);
    return v.tuple([v.none,fn(args=>{
      expect(args).toEqual([views[0]]);
      return v.tuple([v.string("answer = 42\n"),v.cell({})]);
    }),v.none,v.none]);
  }),context);
  const source=Uint8Array.from([..."# coding: source-contract\r\nx"].map(c=>c.charCodeAt(0)));
  expect(decodeByteSource(source,"x",meter,createRuntimeSourceCodecDecoder(context))).toBe("answer = 42\n");
  expect(seen).toEqual([v.string("source_contract")]);
  expect(copies).toEqual([[..."# coding: source-contract\nx\n"].map(c=>c.charCodeAt(0))]);
  expect(source.at(-1)).toBe(120);
});

it("rejects nontext decoder output after tuple validation without reading its consumed field",()=>{
  const {meter,v,fn,registry,context}=fixture();
  registry.register(fn(()=>v.tuple([v.none,fn(()=>v.tuple([v.none,v.cell({})])),v.none,v.none])),context);
  expect(()=>createRuntimeSourceCodecDecoder(context)!("customxyz",new Uint8Array([120]),meter)).toThrow("'customxyz' decoder returned 'NoneType' instead of 'str'; use codecs.decode() to decode to arbitrary types");
});

it("retains decoder failures and observes cancellation before returning source text",()=>{
  const {controller,meter,v,fn,registry,context}=fixture();
  const failure=new PythonRuntimeError("TypeError","guest failed");let cancel=false;
  registry.register(fn(()=>v.tuple([v.none,fn(()=>{
    if(!cancel)throw failure;
    controller.abort();return v.tuple([v.string("pass"),v.integer(0)]);
  }),v.none,v.none])),context);
  const decode=createRuntimeSourceCodecDecoder(context)!;
  expect(()=>decode("customxyz",new Uint8Array([120]),meter)).toThrow(failure);
  cancel=true;
  expect(()=>decode("customxyz",new Uint8Array([120]),meter)).toThrow(ExecutionLimitError);
  expect(()=>meter.checkpoint()).toThrow(ExecutionLimitError);
});

it("does not manufacture a guest buffer when the explicit service is unavailable",()=>{
  const {context,meter}=fixture();
  expect(createRuntimeSourceCodecDecoder(undefined)).toBeUndefined();
  const decode=createRuntimeSourceCodecDecoder({...context,buffers:undefined});
  expect(decode).toBeTypeOf("function");
  expect(()=>decode!("customxyz",new Uint8Array([120]),meter)).toThrow("source codec decoding requires an ownerless memoryview provider");
});

it.each([undefined,{acquireSimple:()=>undefined}])("does not report an unknown encoding when its buffer provider is unavailable: %s",buffers=>{
  const {context,meter,registry,fn,v}=fixture();let searches=0;
  registry.register(fn(()=>{searches++;return v.none;}),context);
  const decode=createRuntimeSourceCodecDecoder({...context,buffers});
  const source=Uint8Array.from([..."# coding: customxyz\nx"].map(character=>character.charCodeAt(0)));
  let failure:unknown;
  try{decodeByteSource(source,"x",meter,decode);}catch(error){failure=error;}
  expect(failure).toBeInstanceOf(Error);
  expect(failure).not.toBeInstanceOf(PythonSyntaxError);
  expect(failure).toMatchObject({message:"source codec decoding requires an ownerless memoryview provider"});
  expect(searches).toBe(0);
});

it("requires the ownerless view only when source decoding leaves the native fast path",()=>{
  const {context,meter}=fixture();
  const decode=createRuntimeSourceCodecDecoder({...context,buffers:undefined});
  for(const encoding of ["utf-8","latin-1","ascii"]){
    const source=`# coding: ${encoding}\nx\n`;
    expect(decodeByteSource(Uint8Array.from([...source].map(character=>character.charCodeAt(0))),"x",meter,decode)).toBe(source);
  }
});

it("keeps cancellation terminal before reporting an unavailable source buffer provider",()=>{
  const {context,meter,controller}=fixture();
  const decode=createRuntimeSourceCodecDecoder({...context,buffers:undefined});
  controller.abort();
  expect(()=>decode!("customxyz",new Uint8Array([120]),meter)).toThrow(ExecutionLimitError);
});

it("uses the invocation registry when compiling bytes without an overriding source policy",()=>{
  const {meter,v,fn,registry,context,copies}=fixture();
  registry.register(fn(()=>v.tuple([v.none,fn(()=>v.tuple([v.string("answer = 42"),v.none])),v.none,v.none])),context);
  let published=false;
  const compilation=createRuntimeCompilation(v,new RuntimeCodePrograms(meter,v),{
    compilation:()=>({enterRecursiveCall:()=>()=>{}}),code(){published=true;return v.none;}
  });
  compilation.compile({source:v.bytes(Uint8Array.from([..."# coding: customxyz\nx"].map(c=>c.charCodeAt(0)))),filename:"x",mode:"exec",flags:0,optimize:0,featureVersion:-1},context,meter);
  expect(published).toBe(true);expect(copies).toHaveLength(1);
});

it("keeps cancellation from the buffer service terminal before guest lookup",()=>{
  const {controller,meter,fn,registry,context}=fixture();let searches=0;
  registry.register(fn(()=>{searches++;throw Error("unreachable");}),context);
  context.buffers!.createReadOnlyView=()=>{controller.abort();throw Error("service failed");};
  const decode=createRuntimeSourceCodecDecoder(context)!;
  expect(()=>decode("customxyz",new Uint8Array([120]),meter)).toThrow(ExecutionLimitError);
  expect(searches).toBe(0);
});

it("retains an owned snapshot when a decoder keeps its source view",()=>{
  const {meter,v,fn,registry,context}=fixture();let retained:ImmutableBytes|undefined;
  context.buffers!.createReadOnlyView=bytes=>{retained=bytes;return v.cell({});};
  registry.register(fn(()=>v.tuple([v.none,fn(()=>v.tuple([v.string("pass"),v.none])),v.none,v.none])),context);
  const source=new Uint8Array([120]);
  createRuntimeSourceCodecDecoder(context)!("customxyz",source,meter);
  source[0]=121;
  expect([...retained!]).toEqual([120]);
});

it.each(["ValueError","TypeError","RuntimeError"] as const)("preserves source decoder %s notes across tokenizer conversion",name=>{
  const {meter,v,fn,registry,context}=fixture();
  const failure=new PythonRuntimeError(name,"decoder failed");
  failure.addNote("existing note",meter);
  registry.register(fn(()=>v.tuple([v.none,fn(()=>{throw failure;}),v.none,v.none])),context);
  const source=Uint8Array.from([..."# coding: edge_source\nx"].map(character=>character.charCodeAt(0)));
  let caught:unknown;
  try{decodeByteSource(source,"x",meter,createRuntimeSourceCodecDecoder(context));}
  catch(error){caught=error;}
  expect(failure.notes).toEqual(["existing note","decoding with 'edge_source' codec failed"]);
  if(name==="ValueError"){
    expect(caught).toBeInstanceOf(PythonSyntaxError);
    expect(caught).not.toBe(failure);
    expect(caught).toMatchObject({message:"decoder failed"});
  }else expect(caught).toBe(failure);
});

it.each(["lookup","tuple","text"] as const)("does not annotate source %s validation failures",stage=>{
  const {meter,v,fn,registry,context}=fixture();
  const lookupFailure=new PythonRuntimeError("TypeError","search failed");
  let notes=0;
  context.addExceptionNote=()=>{notes++;throw Error("unexpected annotation");};
  registry.register(fn(()=>{
    if(stage==="lookup")throw lookupFailure;
    return v.tuple([v.none,fn(()=>stage==="tuple"?v.none:v.tuple([v.none,v.none])),v.none,v.none]);
  }),context);
  expect(()=>createRuntimeSourceCodecDecoder(context)!("edge_source",new Uint8Array([120]),meter)).toThrow(
    stage==="lookup"?lookupFailure:stage==="tuple"?"decoder must return a tuple (object,integer)":"'edge_source' decoder returned 'NoneType' instead of 'str'; use codecs.decode() to decode to arbitrary types"
  );
  expect(notes).toBe(0);
  expect(lookupFailure.notes).toBeUndefined();
});
