import {expect,it} from "vitest";
import {createRuntimeCrcFunctions} from "./runtime-crc-functions.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";
import reference from "./__snapshots__/crc-3.14.7.json";

function fixture(){
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal}),values=new RuntimeValues(meter);
  const keywords=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>0n,equal:(a,b)=>a===b},meter));
  const functions=new Map(createRuntimeCrcFunctions(values,meter));
  const invoke=(name:string,args:RuntimeValue[],context?:BuiltinInvocationContext)=>functions.get(name)!.value.invoke(args,keywords,meter,context);
  return {controller,meter,values,keywords,functions,invoke};
}

it.each(["crc32","crc_hqx"])("%s masks arbitrary Python seeds and returns unsigned integers",name=>{
  const {values:v,invoke}=fixture(),width=name==="crc32"?32n:16n;
  for(const seed of [0n,1n,-1n,-(1n<<100n),(1n<<100n)+7n]){
    expect(invoke(name,[v.bytes(new Uint8Array()),v.integer(seed)])).toEqual(v.integer(seed&((1n<<width)-1n)));
  }
  expect(invoke(name,[v.bytes(Uint8Array.from([49,50,51,52,53,54,55,56,57])),v.integer(0)])).toEqual(v.integer(name==="crc32"?0xcbf43926:0x31c3));
});

it.each(Array.from({length:Math.ceil(reference.rows.length/32)},(_,index)=>index))("replays pinned checksum binding batch %s",batch=>{
  for(const [hex,seed,expected32,expectedHqx] of reference.rows.slice(batch*32,(batch+1)*32)){
    const {values:v,invoke}=fixture();
    const text=hex as string,input=v.bytes(Uint8Array.from({length:text.length/2},(_,index)=>Number.parseInt(text.slice(index*2,index*2+2),16))),initial=v.integer(seed as number);
    expect(invoke("crc32",[input,initial])).toEqual(v.integer(expected32 as number));
    expect(invoke("crc_hqx",[input,initial])).toEqual(v.integer(expectedHqx as number));
  }
});

it.each(["crc32","crc_hqx"])("%s acquires before __index__, reads mutated bytes, then releases",name=>{
  const {values:v,invoke}=fixture(),events:string[]=[],source=v.cell({}),seed=v.cell({});let bytes=v.bytes(Uint8Array.of(65));
  const context:BuiltinInvocationContext={call(){throw Error("unexpected call");},buffers:{acquireSimple(value){
    expect(value).toBe(source);events.push("acquire");return {byteLength:1,copy(){events.push("copy");return bytes.value;},release(){events.push("release");}};
  }},integerIndex:{integer:value=>value.kind==="int"?value.value:undefined,isExactInteger:value=>value.kind==="int",typeName:()=>"Seed",warn(){throw Error("unexpected warning");},lookupIndex(value){
    expect(value).toBe(seed);return ()=>{events.push("index");bytes=v.bytes(Uint8Array.of(66));return v.integer(-1);};
  }}};
  expect(invoke(name,[source,seed],context)).toEqual(v.integer(name==="crc32"?1731059523:35190));
  expect(events).toEqual(["acquire","index","copy","release"]);
});

it.each(["crc32","crc_hqx"])("%s releases leases on failure and terminal cancellation",name=>{
  for(const phase of ["acquire","index","copy"]){
    for(const cancel of [false,true]){
      const {values:v,invoke,controller}=fixture(),events:string[]=[],failure=Error("service failure");
      const fail=()=>{if(cancel)controller.abort();throw failure;};
      const context:BuiltinInvocationContext={call(){throw Error("unexpected call");},buffers:{acquireSimple(){
        events.push("acquire");if(phase==="acquire")return fail();
        return {byteLength:1,copy(){events.push("copy");return fail();},release(){events.push("release");}};
      }},integerIndex:{integer:value=>value.kind==="int"?value.value:undefined,isExactInteger:value=>value.kind==="int",typeName:()=>"Seed",warn(){throw Error("unexpected warning");},lookupIndex(){return ()=>{events.push("index");return phase==="index"?fail():v.integer(0);};}}};
      const run=()=>invoke(name,[v.cell({}),v.cell({})],context);
      expect(run).toThrow(cancel?ExecutionLimitError:failure);
      expect(events.filter(event=>event==="release")).toHaveLength(phase==="acquire"?0:1);
      if(cancel){expect(run).toThrow(ExecutionLimitError);expect(events.filter(event=>event==="acquire")).toHaveLength(1);}
    }
  }
});

it.each(["crc32","crc_hqx"])("%s observes cancellation when services return normally",name=>{
  for(const phase of ["acquire","index","copy"]){
    const {values:v,invoke,controller}=fixture(),events:string[]=[],bytes=v.bytes(Uint8Array.of(65));
    const context:BuiltinInvocationContext={call(){throw Error("unexpected call");},buffers:{acquireSimple(){
      events.push("acquire");if(phase==="acquire")controller.abort();
      return {byteLength:1,copy(){events.push("copy");if(phase==="copy")controller.abort();return bytes.value;},release(){events.push("release");}};
    }},integerIndex:{integer:value=>value.kind==="int"?value.value:undefined,isExactInteger:value=>value.kind==="int",typeName:()=>"Seed",warn(){throw Error("unexpected warning");},lookupIndex(){return ()=>{events.push("index");if(phase==="index")controller.abort();return v.integer(0);};}}};
    const source=v.cell({}),seed=v.cell({}),run=()=>invoke(name,[source,seed],context);
    expect(run).toThrow(ExecutionLimitError);
    expect(events).toEqual(phase==="acquire"?["acquire","release"]:phase==="index"?["acquire","index","release"]:["acquire","index","copy","release"]);
    expect(run).toThrow(ExecutionLimitError);
    expect(events.filter(event=>event==="release")).toHaveLength(1);
  }
});

it.each(["crc32","crc_hqx"])("%s preserves binding diagnostics and metadata",name=>{
  const {values:v,invoke,keywords,functions}=fixture(),fn=functions.get(name)!.value;
  expect(fn.module).toBe("binascii");
  expect(fn.textSignature).toBe(name==="crc32"?"($module, data, crc=0, /)":"($module, data, crc, /)");
  expect(fn.doc).toBe(name==="crc32"?"Compute CRC-32 incrementally.":"Compute CRC-CCITT incrementally.");
  expect(()=>invoke(name,[])).toThrow(name==="crc32"?"crc32 expected at least 1 argument, got 0":"crc_hqx expected 2 arguments, got 0");
  expect(()=>invoke(name,[v.none,v.none])).toThrow("a bytes-like object is required, not 'NoneType'");
  expect(()=>invoke(name,[v.bytes(new Uint8Array()),v.none])).toThrow("'NoneType' object cannot be interpreted as an integer");
  if(name==="crc32")expect(invoke(name,[v.bytes(new Uint8Array())])).toEqual(v.integer(0));
  else expect(()=>invoke(name,[v.bytes(new Uint8Array())])).toThrow("crc_hqx expected 2 arguments, got 1");
  keywords.items.set(v.string("data"),v.none);
  expect(()=>invoke(name,[])).toThrow(`binascii.${name}() takes no keyword arguments`);
});
