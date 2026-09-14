import {expect,it} from "vitest";
import {createRuntimeBase64Functions} from "./runtime-base64-functions.js";
import {BinasciiError} from "./binascii-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";
import reference from "./__snapshots__/base64-native-binding-3.14.7.json";

function fixture(){
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal}),values=new RuntimeValues(meter);
  const keywords=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>0n,equal:(a,b)=>a===b},meter));
  const functions=new Map(createRuntimeBase64Functions(values,meter));
  const invoke=(name:string,args:RuntimeValue[],context?:BuiltinInvocationContext)=>functions.get(name)!.value.invoke(args,keywords,meter,context);
  return {controller,meter,values,keywords,functions,invoke};
}

it.each(reference.cases.map((row,index)=>({...row,index})))("pinned Base64 binding $index: $name",row=>{
  const {values:v,invoke,keywords,meter}=fixture();
  const value=(spec:unknown[]):RuntimeValue=>{
    switch(spec[0]){
      case "bytes":{const hex=spec[1] as string;return v.bytes(Uint8Array.from({length:hex.length/2},(_,i)=>Number.parseInt(hex.slice(i*2,i*2+2),16)));}
      case "str":return v.string(spec[1] as string);
      case "int":return v.integer(BigInt(spec[1] as string));
      case "none":return v.none;
      case "list":return v.list([]);
      default:throw Error("unknown oracle argument");
    }
  };
  for(const [key,input] of Object.entries(row.kwargs))keywords.items.set(v.string(key),value(input!));
  if(row.result.error==="Error"){
    // Module assembly must publish this internal fault as binascii.Error.
    expect(()=>invoke(row.name,row.args.map(value))).toThrow(BinasciiError);
    expect(()=>invoke(row.name,row.args.map(value))).toThrow(row.result.message);
    return;
  }
  let actual:unknown;
  try{
    const result=invoke(row.name,row.args.map(value));
    if(result.kind!=="bytes")throw Error("expected exact bytes");
    actual={hex:[...result.value.toUint8Array(meter)].map(x=>x.toString(16).padStart(2,"0")).join("")};
  }catch(error){actual={error:(error as Error).name,message:(error as Error).message};}
  expect(actual).toEqual(row.result);
});

it.each(["a2b_base64","b2a_base64"] as const)("%s owns native metadata and observes mutations during truth conversion",name=>{
  const {values:v,invoke,keywords,functions}=fixture(),events:string[]=[],source=v.cell({}),flag=v.cell({});
  expect(functions.get(name)!.value).toMatchObject({name,module:"binascii",...reference.metadata[name]});
  keywords.items.set(v.string(name==="a2b_base64"?"strict_mode":"newline"),flag);
  let data=v.bytes(Uint8Array.of(81,81,61,61));
  const context:BuiltinInvocationContext={call(){throw Error("unexpected call");},truth(value){
    expect(value).toBe(flag);events.push("truth");data=v.bytes(Uint8Array.of(81,103,61,61));return false;
  },buffers:{acquireSimple(value){expect(value).toBe(source);events.push("acquire");return {byteLength:4,copy(){events.push("copy");return data.value;},release(){events.push("release");}};}}};
  expect(invoke(name,[source],context)).toEqual(v.bytes(name==="a2b_base64"?Uint8Array.of(66):Uint8Array.of(85,87,99,57,80,81,61,61)));
  expect(events).toEqual(["acquire","truth","copy","release"]);
});

it.each(["a2b_base64","b2a_base64"])("%s releases buffers through failures and terminal cancellation",name=>{
  for(const phase of ["acquire","truth","copy"])for(const cancel of [false,true])for(const throws of [false,true]){
    const {values:v,invoke,keywords,controller}=fixture(),events:string[]=[],failure=new PythonRuntimeError("ValueError","service failure");
    keywords.items.set(v.string(name==="a2b_base64"?"strict_mode":"newline"),v.cell({}));
    const boundary=(point:string)=>{events.push(point);if(phase===point){if(cancel)controller.abort();if(throws)throw failure;}};
    const context:BuiltinInvocationContext={call(){throw Error("unexpected call");},truth(){boundary("truth");return false;},buffers:{acquireSimple(){boundary("acquire");return {byteLength:4,copy(){boundary("copy");return v.bytes(Uint8Array.of(81,81,61,61)).value;},release(){events.push("release");}};}}};
    const run=()=>invoke(name,[v.none],context);
    if(cancel)expect(run).toThrow(ExecutionLimitError);
    else if(throws)expect(run).toThrow(phase==="acquire"&&name==="a2b_base64"?"argument should be bytes, buffer or ASCII string, not 'NoneType'":failure);
    else expect(run().kind).toBe("bytes");
    expect(events.filter(x=>x==="release")).toHaveLength(phase==="acquire"&&throws?0:1);
    if(cancel){expect(run).toThrow(ExecutionLimitError);expect(events.filter(x=>x==="acquire")).toHaveLength(1);}
  }
});

it.each(["a2b_base64","b2a_base64"])("%s preserves opaque host acquisition failures",name=>{
  const {values:v,invoke}=fixture(),failure=Error("opaque");
  expect(()=>invoke(name,[v.none],{call(){throw Error("unexpected call");},buffers:{acquireSimple(){throw failure;}}})).toThrow(failure);
});
