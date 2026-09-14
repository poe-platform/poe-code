import {expect,it} from "vitest";
import {createRuntimeUuFunctions} from "./runtime-uu-functions.js";
import {BinasciiError} from "./binascii-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";
import reference from "./__snapshots__/uu-argument-matrix-3.14.7.json";

function fixture(){
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal}),values=new RuntimeValues(meter);
  const keywords=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>0n,equal:(a,b)=>a===b},meter));
  const functions=new Map(createRuntimeUuFunctions(values,meter));
  const invoke=(name:string,args:RuntimeValue[],context?:BuiltinInvocationContext)=>functions.get(name)!.value.invoke(args,keywords,meter,context);
  return {controller,meter,values,keywords,functions,invoke};
}

it.each(["a2b_uu","b2a_uu"] as const)("matches every pinned %s argument vector",name=>{
  for(const row of reference.cases.filter(row=>row.name===name)){
    const {values:v,invoke,keywords,meter,functions}=fixture();
    expect(functions.get(name)!.value).toMatchObject({name,module:"binascii",...reference.metadata[name]});
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
      const result=invoke(name,row.args.map(value));
      if(result.kind!=="bytes")throw Error("expected exact bytes");
      actual={hex:[...result.value.toUint8Array(meter)].map(x=>x.toString(16).padStart(2,"0")).join("")};
    }catch(error){actual={error:error instanceof BinasciiError?"Error":(error as Error).name,message:(error as Error).message};}
    expect(actual,JSON.stringify(row)).toEqual(row.result);
  }
});

it("pins the buffer until backtick conversion and copying finish",()=>{
  const {values:v,invoke,keywords}=fixture(),events:string[]=[],source=v.cell({}),flag=v.cell({});
  let data=v.bytes(Uint8Array.of(65));
  keywords.items.set(v.string("backtick"),flag);
  const context:BuiltinInvocationContext={call(){throw Error("unexpected call");},truth(value){
    expect(value).toBe(flag);events.push("truth");data=v.bytes(Uint8Array.of(0));return true;
  },buffers:{acquireSimple(value){expect(value).toBe(source);events.push("acquire");return {byteLength:1,copy(){events.push("copy");return data.value;},release(){events.push("release");}};}}};
  expect(invoke("b2a_uu",[source],context)).toEqual(v.bytes(Uint8Array.of(33,96,96,96,96,10)));
  expect(events).toEqual(["acquire","truth","copy","release"]);
});

it.each(["a2b_uu","b2a_uu"])("%s releases exports after guest failure or cancellation",name=>{
  for(const phase of name==="b2a_uu"?["acquire","truth","copy"]:["acquire","copy"])for(const cancel of [false,true])for(const throws of [false,true]){
    const {values:v,invoke,keywords,controller}=fixture(),events:string[]=[],failure=new PythonRuntimeError("ValueError","service failure");
    if(name==="b2a_uu")keywords.items.set(v.string("backtick"),v.cell({}));
    const boundary=(point:string)=>{events.push(point);if(phase===point){if(cancel)controller.abort();if(throws)throw failure;}};
    const context:BuiltinInvocationContext={call(){throw Error("unexpected call");},truth(){boundary("truth");return false;},buffers:{acquireSimple(){boundary("acquire");return {byteLength:1,copy(){boundary("copy");return v.bytes(Uint8Array.of(32)).value;},release(){events.push("release");}};}}};
    const run=()=>invoke(name,[v.none],context);
    if(cancel)expect(run).toThrow(ExecutionLimitError);
    else if(throws)expect(run).toThrow(phase==="acquire"&&name==="a2b_uu"?"argument should be bytes, buffer or ASCII string, not 'NoneType'":failure);
    else expect(run().kind).toBe("bytes");
    expect(events.filter(x=>x==="release")).toHaveLength(phase==="acquire"&&throws?0:1);
    if(cancel){expect(run).toThrow(ExecutionLimitError);expect(events.filter(x=>x==="acquire")).toHaveLength(1);}
  }
});

it.each(["a2b_uu","b2a_uu"])("%s preserves opaque acquisition failures",name=>{
  const {values:v,invoke}=fixture(),failure=Error("opaque");
  expect(()=>invoke(name,[v.none],{call(){throw Error("unexpected call");},buffers:{acquireSimple(){throw failure;}}})).toThrow(failure);
});
