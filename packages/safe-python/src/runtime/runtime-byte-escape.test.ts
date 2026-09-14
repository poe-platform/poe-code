import {expect,it} from "vitest";
import cases from "./__snapshots__/byte-escape-3.14.7.json";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {createRuntimeCoreCodecFunctions} from "./runtime-core-codec-functions.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {ImmutableBytes} from "./immutable-bytes.js";
import {PythonRuntimeError} from "./error.js";
import {PythonEncodeError} from "./encode-error.js";

function fixture(signal?:AbortSignal){
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:2000000,signal}),values=new RuntimeValues(meter);
  const functions=createRuntimeCoreCodecFunctions(new RuntimeCodecRegistry(values,meter));
  const empty=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>0n,equal:(a,b)=>a===b},meter));
  const warnings:string[][]=[];
  const context:BuiltinInvocationContext={call:()=>{throw Error("unexpected guest call");},warn:(category,message)=>{warnings.push([category,message]);}};
  const invoke=(operation:string,args:RuntimeValue[],override:BuiltinInvocationContext=context)=>{
    const fn=functions.get(`escape_${operation}`);
    expect(fn,"native escape binding").toBeDefined();
    return fn!.value.invoke(args,empty,meter,override);
  };
  return {meter,values,empty,functions,warnings,context,invoke};
}

it.each(cases)("matches pinned byte escape $operation($input, $errors)",row=>{
  const {values,invoke,warnings}=fixture();
  const run=()=>invoke(row.operation,[values.bytes(Uint8Array.from(row.input)),values.string(row.errors)]);
  if(row.error!==undefined){
    let failure:unknown;try{run();}catch(error){failure=error;}
    expect(failure).toBeInstanceOf(PythonRuntimeError);
    expect(failure).toMatchObject({name:row.error,message:row.message});
  }else{
    const result=run();
    if(result.kind!=="tuple"||result.items[0].kind!=="bytes")throw Error("expected bytes tuple");
    expect([...result.items[0].value]).toEqual(row.output);
    expect(result.items[1]).toMatchObject({kind:"int",value:BigInt(row.consumed!)});
  }
  expect(warnings).toEqual(row.warnings);
});

it("retains byte escape result identity contracts",()=>{
  const {values,invoke}=fixture();
  for(const operation of ["encode","decode"]){
    for(const data of [[],[65],[65,66]]){
      const source=values.bytes(Uint8Array.from(data)),result=invoke(operation,[source]);
      if(result.kind!=="tuple")throw Error("expected tuple");
      expect(result.items[0]===source).toBe(data.length===0||operation==="decode"&&data.length===1);
    }
  }
});

it.each(["success","bad-errors","copy-failure","warning-failure","cancel-copy","cancel-warning"])("releases escape decode buffers on %s",mode=>{
  const controller=new AbortController(),{values,meter,context,invoke}=fixture(controller.signal),events:string[]=[];
  const source=values.list([]);
  const call=()=>invoke("decode",[source,mode==="bad-errors"?values.integer(42):values.none],{...context,
    buffers:{acquireSimple:()=>{
      events.push("acquire");return {byteLength:2,copy:()=>{
        events.push("copy");if(mode==="copy-failure")throw Error("copy failed");
        const result=ImmutableBytes.copyOf([92,113],meter);
        if(mode==="cancel-copy")controller.abort();return result;
      },release:()=>{events.push("release");}};
    }},
    warn:()=>{events.push("warn");if(mode==="cancel-warning")controller.abort();if(mode==="warning-failure")throw Error("warning failed");}
  });
  if(mode==="success")expect(call().kind).toBe("tuple");
  else expect(call).toThrow(mode.startsWith("cancel")?ExecutionLimitError:mode==="bad-errors"?"escape_decode() argument 2 must be str or None, not int":mode==="copy-failure"?"copy failed":"warning failed");
  expect(events).toEqual(mode==="bad-errors"?["acquire","release"]:mode==="copy-failure"||mode==="cancel-copy"?["acquire","copy","release"]:["acquire","copy","warn","release"]);
});

it.each(["encode","decode"])("validates escape_%s arguments before transforming data",operation=>{
  const {values,invoke,functions,empty,meter,context}=fixture(),source=values.bytes(new Uint8Array());
  expect(()=>invoke(operation,[])).toThrow(`escape_${operation} expected at least 1 argument, got 0`);
  expect(()=>invoke(operation,[source,values.none,values.none])).toThrow(`escape_${operation} expected at most 2 arguments, got 3`);
  const keywords=values.dictionary(empty.items.emptyCopy());keywords.items.set(values.string("data"),source);
  expect(()=>functions.get(`escape_${operation}`)!.value.invoke([],keywords,meter,context)).toThrow(`_codecs.escape_${operation}() takes no keyword arguments`);
  expect(()=>invoke(operation,[values.none,values.integer(42)])).toThrow(operation==="encode"?"escape_encode() argument 1 must be bytes, not None":"a bytes-like object is required, not 'NoneType'");
  expect(()=>invoke(operation,[source,values.integer(42)])).toThrow(`escape_${operation}() argument 2 must be str or None, not int`);
  expect(()=>invoke(operation,[source,values.string("ignore\0")])).toThrow("embedded null character");
  expect(invoke(operation,[source,values.none])).toMatchObject({kind:"tuple"});
  const bad=values.string("\0\ud800"),sentinel=new Error("prepared unicode error");
  expect(()=>invoke(operation,[source,bad],{...context,prepareException:(error,retained)=>{
    expect(error).toBeInstanceOf(PythonEncodeError);
    expect(error).toMatchObject({encoding:"utf-8",start:1,end:2,reason:"surrogates not allowed"});
    expect(retained?.unicodeObject).toBe(bad);return sentinel;
  }})).toThrow(sentinel);
});

it("escape_decode converts text to strict UTF-8 before checking errors",()=>{
  const {values,invoke,context}=fixture();
  const result=invoke("decode",[values.string("é🐍")]);
  if(result.kind!=="tuple"||result.items[0].kind!=="bytes")throw Error("expected bytes tuple");
  expect([...result.items[0].value]).toEqual([195,169,240,159,144,141]);
  expect(result.items[1]).toMatchObject({kind:"int",value:6n});
  const source=values.string("\ud800"),sentinel=new Error("source surrogate");
  expect(()=>invoke("decode",[source,values.integer(42)],{...context,prepareException:(error,retained)=>{
    expect(error).toBeInstanceOf(PythonEncodeError);expect(retained?.unicodeObject).toBe(source);return sentinel;
  }})).toThrow(sentinel);
});

it("escape_encode rejects exporters without acquiring a buffer",()=>{
  const {values,invoke,context}=fixture();
  expect(()=>invoke("encode",[values.list([])],{...context,buffers:{acquireSimple:()=>{throw Error("must not acquire");}}})).toThrow("escape_encode() argument 1 must be bytes, not list");
});

it.each(["unavailable","export-failure","cancel-acquire","cancel-export-failure","cancel-warning-failure"])("preserves escape decoder service failure and cancellation: %s",mode=>{
  const controller=new AbortController(),{values,invoke,context,meter}=fixture(controller.signal),events:string[]=[];
  const error=new Error("guest failure");
  const run=()=>invoke("decode",[values.list([])],{...context,buffers:{acquireSimple:()=>{
    events.push("acquire");
    if(mode==="unavailable")return undefined;
    if(mode==="cancel-acquire"||mode==="cancel-export-failure")controller.abort();
    if(mode.endsWith("export-failure"))throw error;
    return {byteLength:2,copy:()=>{events.push("copy");return ImmutableBytes.copyOf([92,113],meter);},release:()=>{events.push("release");}};
  }},warn:()=>{events.push("warn");controller.abort();throw error;}});
  expect(run).toThrow(mode.startsWith("cancel")?ExecutionLimitError:mode==="unavailable"?"a bytes-like object is required, not 'list'":error);
  expect(events).toEqual(mode==="cancel-acquire"?["acquire","release"]:mode==="cancel-warning-failure"?["acquire","copy","warn","release"]:["acquire"]);
});
