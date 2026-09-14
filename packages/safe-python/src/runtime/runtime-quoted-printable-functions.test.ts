import {expect,it} from "vitest";
import {createRuntimeQuotedPrintableFunctions} from "./runtime-quoted-printable-functions.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";
import reference from "./__snapshots__/qp-native-binding-3.14.7.json";
import corpus from "./__snapshots__/quoted-printable-3.14.7.json";

function fixture(){
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal}),values=new RuntimeValues(meter);
  const keywords=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>0n,equal:(a,b)=>a===b},meter));
  const functions=new Map(createRuntimeQuotedPrintableFunctions(values,meter));
  const invoke=(name:string,args:RuntimeValue[],context?:BuiltinInvocationContext)=>functions.get(name)!.value.invoke(args,keywords,meter,context);
  return {controller,meter,values,keywords,functions,invoke};
}

it.each(reference.cases.map((row,index)=>({...row,index})))("pinned quoted-printable binding $index: $name",row=>{
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
  let actual:unknown;
  try{
    const result=invoke(row.name,row.args.map(value));
    if(result.kind!=="bytes")throw Error("expected exact bytes");
    actual={hex:[...result.value.toUint8Array(meter)].map(x=>x.toString(16).padStart(2,"0")).join("")};
  }catch(error){actual={error:(error as Error).name,message:(error as Error).message};}
  expect(actual).toEqual(row.result);
});

it.each([0,1,2])("b2a_qp preserves conversion order and releases the export when flag %s fails or cancels",stop=>{
  for(const cancel of [false,true])for(const throws of [false,true]){
    const {values:v,invoke,controller}=fixture(),events:string[]=[],failure=new PythonRuntimeError("ValueError","option failure");
    const flags=[v.cell({}),v.cell({}),v.cell({})];
    let data=v.bytes(Uint8Array.of(65));
    const context:BuiltinInvocationContext={call(){throw Error("unexpected call");},truth(value){
      const index=flags.indexOf(value as typeof flags[number]);
      events.push(`flag${index}`);
      data=v.bytes(Uint8Array.of(66+index));
      if(index===stop){if(cancel)controller.abort();if(throws)throw failure;}
      return true;
    },buffers:{acquireSimple(){events.push("acquire");return {byteLength:1,copy(){events.push("copy");return data.value;},release(){events.push("release");}};}}};
    const run=()=>invoke("b2a_qp",[v.cell({}),...flags],context);
    if(cancel)expect(run).toThrow(ExecutionLimitError);
    else if(throws)expect(run).toThrow(failure);
    else expect(run()).toEqual(v.bytes(Uint8Array.of(68)));
    expect(events).toEqual(["acquire",...flags.slice(0,cancel||throws?stop+1:3).map((_,i)=>`flag${i}`),...cancel||throws?[]:["copy"],"release"]);
    if(cancel){expect(run).toThrow(ExecutionLimitError);expect(events.at(-1)).toBe("release");}
  }
});

// Bound each in-memory replay without reducing the retained oracle inventory.
it.each((["encode","decode"] as const).flatMap(operation=>Array.from({length:Math.ceil(corpus[operation].length/500)},(_,chunk)=>({operation,chunk}))))("replays every pinned $operation result through the binding, chunk $chunk",({operation,chunk})=>{
  for(const row of corpus[operation].slice(chunk*500,(chunk+1)*500)){
    const {values:v,invoke,meter}=fixture(),input=row[0] as string;
    const bytes=Uint8Array.from({length:input.length/2},(_,index)=>Number.parseInt(input.slice(index*2,index*2+2),16));
    const args=[v.bytes(bytes),...row.slice(1,-1).map(flag=>v.boolean(flag as boolean))];
    const result=invoke(operation==="encode"?"b2a_qp":"a2b_qp",args);
    expect(result.kind).toBe("bytes");
    if(result.kind!=="bytes")throw Error("expected native bytes");
    expect([...result.value.toUint8Array(meter)].map(byte=>byte.toString(16).padStart(2,"0")).join(""),JSON.stringify(row)).toBe(row.at(-1));
  }
});

it.each(["a2b_qp","b2a_qp"] as const)("%s owns native metadata and observes mutations during truth conversion",name=>{
  const {values:v,invoke,keywords,functions}=fixture(),events:string[]=[],source=v.cell({}),flag=v.cell({});
  expect(functions.get(name)!.value).toMatchObject({name,module:"binascii",...reference.metadata[name]});
  keywords.items.set(v.string("header"),flag);
  let data=v.bytes(Uint8Array.of(81,81,61,61));
  const context:BuiltinInvocationContext={call(){throw Error("unexpected call");},truth(value){
    expect(value).toBe(flag);events.push("truth");data=v.bytes(Uint8Array.of(81,103,61,61));return false;
  },buffers:{acquireSimple(value){expect(value).toBe(source);events.push("acquire");return {byteLength:4,copy(){events.push("copy");return data.value;},release(){events.push("release");}};}}};
  expect(invoke(name,[source],context)).toEqual(v.bytes(name==="a2b_qp"?Uint8Array.of(81,103,61):Uint8Array.of(81,103,61,51,68,61,51,68)));
  expect(events).toEqual(["acquire","truth","copy","release"]);
});

it.each(["a2b_qp","b2a_qp"])("%s releases buffers through failures and terminal cancellation",name=>{
  for(const phase of ["acquire","truth","copy"])for(const cancel of [false,true])for(const throws of [false,true]){
    const {values:v,invoke,keywords,controller}=fixture(),events:string[]=[],failure=new PythonRuntimeError("ValueError","service failure");
    keywords.items.set(v.string("header"),v.cell({}));
    const boundary=(point:string)=>{events.push(point);if(phase===point){if(cancel)controller.abort();if(throws)throw failure;}};
    const context:BuiltinInvocationContext={call(){throw Error("unexpected call");},truth(){boundary("truth");return false;},buffers:{acquireSimple(){boundary("acquire");return {byteLength:4,copy(){boundary("copy");return v.bytes(Uint8Array.of(81,81,61,61)).value;},release(){events.push("release");}};}}};
    const run=()=>invoke(name,[v.none],context);
    if(cancel)expect(run).toThrow(ExecutionLimitError);
    else if(throws)expect(run).toThrow(phase==="acquire"&&name==="a2b_qp"?"argument should be bytes, buffer or ASCII string, not 'NoneType'":failure);
    else expect(run().kind).toBe("bytes");
    expect(events.filter(x=>x==="release")).toHaveLength(phase==="acquire"&&throws?0:1);
    if(cancel){expect(run).toThrow(ExecutionLimitError);expect(events.filter(x=>x==="acquire")).toHaveLength(1);}
  }
});

it.each(["a2b_qp","b2a_qp"])("%s preserves opaque host acquisition failures",name=>{
  const {values:v,invoke}=fixture(),failure=Error("opaque");
  expect(()=>invoke(name,[v.none],{call(){throw Error("unexpected call");},buffers:{acquireSimple(){throw failure;}}})).toThrow(failure);
});
