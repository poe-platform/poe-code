import {expect,it} from "vitest";
import {createRuntimeHexadecimalFunctions} from "./runtime-hexadecimal-functions.js";
import {PythonRuntimeError} from "./error.js";
import {BinasciiError} from "./binascii-error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";
import reference from "./__snapshots__/hexadecimal-native-binding-3.14.7.json";
import kernelReference from "./__snapshots__/hexadecimal-3.14.7.json";

const bytes=(hex:string)=>Uint8Array.from({length:hex.length/2},(_,index)=>Number.parseInt(hex.slice(index*2,index*2+2),16));
function fixture(){
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal}),values=new RuntimeValues(meter);
  const keywords=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>0n,equal:(a,b)=>a===b},meter));
  const functions=new Map(createRuntimeHexadecimalFunctions(values,meter));
  const invoke=(name:string,args:RuntimeValue[],context?:BuiltinInvocationContext)=>functions.get(name)!.value.invoke(args,keywords,meter,context);
  return {controller,meter,values,keywords,functions,invoke};
}

it.each(reference.cases.map((row,index)=>({...row,index})))("pinned native hexadecimal case $index: $name",row=>{
  const {values:v,invoke,keywords,meter}=fixture();
  const value=(spec:unknown[]):RuntimeValue=>{
    switch(spec[0]){
      case "bytes":return v.bytes(bytes(spec[1] as string));
      case "str":return v.string(spec[1] as string);
      case "int":return v.integer(BigInt(spec[1] as string));
      case "none":return v.none;
      case "list":return v.list((spec[1] as number[]).map(x=>v.integer(x)));
      default:throw Error("unknown oracle argument");
    }
  };
  for(const [key,input] of Object.entries(row.kwargs))keywords.items.set(v.string(key),value(input!));
  if(row.result.error==="Error"){
    // The internal fault must still be published as the real binascii.Error
    // by module assembly; this test does not claim that publication exists.
    const run=()=>invoke(row.name,row.args.map(value));
    expect(run).toThrow(BinasciiError);
    expect(run).toThrow(row.result.message);
    return;
  }
  let actual:unknown;
  try{
    const result=invoke(row.name,row.args.map(value));
    if(result.kind!=="bytes")throw Error("hexadecimal binding must return exact bytes");
    actual={hex:[...result.value.toUint8Array(meter)].map(x=>x.toString(16).padStart(2,"0")).join("")};
  }catch(error){actual={error:(error as Error).name,message:(error as Error).message};}
  expect(actual).toEqual(row.result);
});

it.each(["hexlify","b2a_hex"])("%s retains the complete pinned kernel encode corpus",name=>{
  for(const [input,separator,group,expected] of kernelReference.encode){
    const {values:v,invoke}=fixture();
    const args=[v.bytes(bytes(input as string))];
    if(separator!==null)args.push(v.bytes(Uint8Array.of(separator as number)));
    // Omitted separators still validate grouping via its keyword slot.
    const state=separator===null?undefined:v.integer(group as number);
    expect(invoke(name,state===undefined?args:[...args,state])).toEqual(v.bytes(bytes(expected as string)));
  }
});

it.each(["unhexlify","a2b_hex"])("%s retains the complete pinned kernel decode corpus",name=>{
  for(const [input,expected,message] of kernelReference.decode){
    const {values:v,invoke}=fixture(),run=()=>invoke(name,[v.bytes(bytes(input!))]);
    if(message===null)expect(run()).toEqual(v.bytes(bytes(expected!)));
    else{
      expect(run).toThrow(BinasciiError);
      expect(run).toThrow(message);
    }
  }
});

it.each(["hexlify","b2a_hex","unhexlify","a2b_hex"])("%s never reclassifies opaque host export failures",name=>{
  const {values:v,invoke}=fixture(),failure=Error("opaque host failure");
  const context:BuiltinInvocationContext={call(){throw Error("unexpected call");},buffers:{acquireSimple(){throw failure;}}};
  expect(()=>invoke(name,[v.none],context)).toThrow(failure);
});

it("preserves the four distinct native callables and their pinned metadata",()=>{
  const {functions}=fixture();
  expect(new Set([...functions.values()])).toHaveProperty("size",4);
  for(const [name,expected] of Object.entries(reference.metadata)){
    expect(functions.get(name)!.value).toMatchObject({name,module:"binascii",...expected});
  }
});

it.each(["hexlify","b2a_hex"])("%s pins input before index conversion and reads later mutations",name=>{
  const {values:v,invoke}=fixture(),events:string[]=[],source=v.cell({}),group=v.cell({});let input=v.bytes(Uint8Array.of(65,66));
  const context:BuiltinInvocationContext={call(){throw Error("unexpected call");},buffers:{acquireSimple(value){
    expect(value).toBe(source);events.push("acquire");return {byteLength:2,copy(){events.push("copy");return input.value;},release(){events.push("release");}};
  }},integerIndex:{integer:value=>value.kind==="int"?value.value:undefined,isExactInteger:value=>value.kind==="int",typeName:()=>"Group",warn(){throw Error("unexpected warning");},lookupIndex(value){
    expect(value).toBe(group);return ()=>{events.push("index");input=v.bytes(Uint8Array.of(67,68));return v.integer(-1);};
  }}};
  expect(invoke(name,[source,v.string("é"),group],context)).toEqual(v.bytes(Uint8Array.of(52,51,233,52,52)));
  expect(events).toEqual(["acquire","index","copy","release"]);
});

it.each(["hexlify","b2a_hex","unhexlify","a2b_hex"])("%s releases owned buffers on failure and terminal cancellation",name=>{
  for(const phase of ["acquire","copy"]){
    for(const cancel of [false,true])for(const throws of [false,true]){
      const {values:v,invoke,controller}=fixture(),events:string[]=[],failure=new PythonRuntimeError("ValueError","service failure"),input=v.bytes(bytes("3431"));
      const boundary=()=>{if(cancel)controller.abort();if(throws)throw failure;};
      const context:BuiltinInvocationContext={call(){throw Error("unexpected call");},buffers:{acquireSimple(){
        events.push("acquire");if(phase==="acquire")boundary();
        return {byteLength:2,copy(){events.push("copy");if(phase==="copy")boundary();return input.value;},release(){events.push("release");}};
      }}};
      const run=()=>invoke(name,[v.none],context);
      if(cancel)expect(run).toThrow(ExecutionLimitError);
      else if(throws)expect(run).toThrow(phase==="acquire"&&(name==="unhexlify"||name==="a2b_hex")?"argument should be bytes, buffer or ASCII string, not 'NoneType'":failure);
      else expect(run().kind).toBe("bytes");
      expect(events.filter(x=>x==="release")).toHaveLength(phase==="acquire"&&throws?0:1);
      if(cancel){expect(run).toThrow(ExecutionLimitError);expect(events.filter(x=>x==="acquire")).toHaveLength(1);}
    }
  }
});
