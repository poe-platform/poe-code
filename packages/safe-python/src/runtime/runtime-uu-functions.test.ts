import {expect,it} from "vitest";
import {createRuntimeUuFunctions} from "./runtime-uu-functions.js";
import {PythonRuntimeError} from "./error.js";
import {BinasciiError} from "./binascii-error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";
import reference from "./__snapshots__/uu-native-binding-3.14.7.json";
import kernelReference from "./__snapshots__/uuencode-3.14.7.json";

function fixture(){
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal}),values=new RuntimeValues(meter);
  const keywords=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>0n,equal:(a,b)=>a===b},meter));
  const functions=new Map(createRuntimeUuFunctions(values,meter));
  const invoke=(name:string,args:RuntimeValue[],context?:BuiltinInvocationContext)=>functions.get(name)!.value.invoke(args,keywords,meter,context);
  return {controller,meter,values,keywords,functions,invoke};
}

it.each(reference.cases.map((row,index)=>({...row,index})))("pinned UU binding $index: $name",row=>{
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
    // Internal native faults are not yet published guest binascii.Error objects.
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

it.each(["a2b_uu","b2a_uu"] as const)("%s owns pinned metadata and copies the leased input after option conversion",name=>{
  const {values:v,invoke,keywords,functions}=fixture(),events:string[]=[],source=v.cell({}),flag=v.cell({});
  expect(functions.get(name)!.value).toMatchObject({name,module:"binascii",...reference.metadata[name]});
  if(name==="b2a_uu")keywords.items.set(v.string("backtick"),flag);
  let data=v.bytes(name==="a2b_uu"?Uint8Array.of(33,32,32,32,32,10):Uint8Array.of(1));
  const context:BuiltinInvocationContext={call(){throw Error("unexpected call");},truth(value){
    expect(value).toBe(flag);events.push("truth");data=v.bytes(Uint8Array.of(0));return true;
  },buffers:{acquireSimple(value){expect(value).toBe(source);events.push("acquire");return {byteLength:data.value.length,copy(){events.push("copy");return data.value;},release(){events.push("release");}};}}};
  expect(invoke(name,[source],context)).toEqual(v.bytes(name==="a2b_uu"?Uint8Array.of(0):Uint8Array.of(33,96,96,96,96,10)));
  expect(events).toEqual(name==="a2b_uu"?["acquire","copy","release"]:["acquire","truth","copy","release"]);
});

it.each(["a2b_uu","b2a_uu"])("%s releases buffers on service failures and preserves terminal cancellation",name=>{
  for(const phase of name==="a2b_uu"?["acquire","copy"]:["acquire","truth","copy"])for(const cancel of [false,true])for(const throws of [false,true]){
    const {values:v,invoke,keywords,controller}=fixture(),events:string[]=[],failure=new PythonRuntimeError("ValueError","service failure");
    const bytes=v.bytes(Uint8Array.of(33,32,32,32,32,10));
    if(name==="b2a_uu")keywords.items.set(v.string("backtick"),v.cell({}));
    const boundary=(point:string)=>{events.push(point);if(phase===point){if(cancel)controller.abort();if(throws)throw failure;}};
    const context:BuiltinInvocationContext={call(){throw Error("unexpected call");},truth(){boundary("truth");return false;},buffers:{acquireSimple(){boundary("acquire");return {byteLength:6,copy(){boundary("copy");return bytes.value;},release(){events.push("release");}};}}};
    const run=()=>invoke(name,[v.none],context);
    if(cancel)expect(run).toThrow(ExecutionLimitError);
    else if(throws)expect(run).toThrow(phase==="acquire"&&name==="a2b_uu"?"argument should be bytes, buffer or ASCII string, not 'NoneType'":failure);
    else expect(run().kind).toBe("bytes");
    expect(events.filter(x=>x==="release")).toHaveLength(phase==="acquire"&&throws?0:1);
    if(cancel){expect(run).toThrow(ExecutionLimitError);expect(events.filter(x=>x==="acquire")).toHaveLength(1);}
  }
});

it.each(["a2b_uu","b2a_uu"])("%s preserves opaque host acquisition failures",name=>{
  const {values:v,invoke}=fixture(),failure=Error("opaque");
  expect(()=>invoke(name,[v.none],{call(){throw Error("unexpected call");},buffers:{acquireSimple(){throw failure;}}})).toThrow(failure);
});

it("does not invoke type-name services after decoder exception classification cancels",()=>{
  const {values:v,invoke,controller}=fixture(),failure=Error("export failure");
  let classifications=0,names=0;
  const context:BuiltinInvocationContext={call(){throw Error("unexpected call");},
    isException(){classifications++;controller.abort();return true;},
    buffers:{acquireSimple(){throw failure;},typeName(){names++;return "Export";}}
  };
  expect(()=>invoke("a2b_uu",[v.none],context)).toThrow(ExecutionLimitError);
  expect(classifications).toBe(1);
  expect(names).toBe(0);
});

const nativeCases=[
  ...kernelReference.encode.map(([input,backtick,expected,message])=>({name:"b2a_uu",input:input as string,backtick:backtick as boolean,expected,message})),
  ...kernelReference.decode.map(([input,expected,message])=>({name:"a2b_uu",input:input!,backtick:false,expected,message}))
];
const batches=Array.from({length:Math.ceil(nativeCases.length/128)},(_,index)=>({index,rows:nativeCases.slice(index*128,(index+1)*128)}));
it.each(batches)("replays the complete pinned UU byte corpus through native binding batch $index",({rows})=>{
  for(const row of rows){
    const {values:v,invoke,keywords,meter}=fixture();
    if(row.name==="b2a_uu")keywords.items.set(v.string("backtick"),v.boolean(row.backtick));
    const source=v.bytes(Uint8Array.from({length:row.input.length/2},(_,i)=>Number.parseInt(row.input.slice(i*2,i*2+2),16)));
    if(row.message!==null){
      expect(()=>invoke(row.name,[source])).toThrow(BinasciiError);
      expect(()=>invoke(row.name,[source])).toThrow(row.message!);
    }else{
      const result=invoke(row.name,[source]);
      expect(result.kind).toBe("bytes");
      if(result.kind!=="bytes")throw Error("expected exact bytes");
      expect([...result.value.toUint8Array(meter)].map(byte=>byte.toString(16).padStart(2,"0")).join("")).toBe(row.expected);
    }
  }
});
