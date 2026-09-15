import {expect,it} from "vitest";
import {createRuntimeQuotedPrintableFunctions} from "./runtime-quoted-printable-functions.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";
import reference from "./__snapshots__/quoted-printable-binding-3.14.7.json";
import corpus from "./__snapshots__/quoted-printable-3.14.7.json";

const bytes=(hex:string)=>Uint8Array.from({length:hex.length/2},(_,index)=>Number.parseInt(hex.slice(index*2,index*2+2),16));
function fixture(){
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal}),values=new RuntimeValues(meter);
  const keywords=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>0n,equal:(a,b)=>a===b},meter));
  const functions=new Map(createRuntimeQuotedPrintableFunctions(values,meter));
  const invoke=(name:string,args:RuntimeValue[],context?:BuiltinInvocationContext)=>functions.get(name)!.value.invoke(args,keywords,meter,context);
  function value(input:unknown):RuntimeValue {
    if(input===null)return values.none;
    if(typeof input==="boolean")return values.boolean(input);
    if(typeof input==="number")return values.integer(input);
    if(typeof input==="string")return values.string(input);
    if(Array.isArray(input))return values.list(input.map(value));
    return values.bytes(bytes((input as {bytes:string}).bytes));
  }
  return {controller,meter,values,keywords,functions,invoke,value};
}

it.each(reference.rows)("matches pinned $name arguments $args $kwargs",row=>{
  const {invoke,keywords,values:v,value,meter}=fixture();
  for(const [key,item] of Object.entries(row.kwargs))keywords.items.set(v.string(key),value(item));
  let actual:unknown;
  try {
    const result=invoke(row.name,row.args.map(value));
    expect(result.kind).toBe("bytes");
    actual=["ok",result.kind==="bytes"?[...result.value.toUint8Array(meter)].map(byte=>byte.toString(16).padStart(2,"0")).join(""):null];
  }catch(error){if(!(error instanceof PythonRuntimeError))throw error;actual=["error",error.name,error.message];}
  expect(actual).toEqual(row.result);
});

for(const operation of ["encode","decode"] as const){
  it.each(Array.from({length:Math.ceil(corpus[operation].length/64)},(_,index)=>index))(`replays every pinned ${operation} transform batch %s`,batch=>{
    for(const row of corpus[operation].slice(batch*64,(batch+1)*64)){
      const {invoke,values:v}=fixture(),input=v.bytes(bytes(row[0] as string));
      const args=operation==="encode"?[input,...row.slice(1,4).map(flag=>v.boolean(flag as boolean))]:[input,v.boolean(row[1] as boolean)];
      const result=invoke(operation==="encode"?"b2a_qp":"a2b_qp",args);
      expect(result).toEqual(v.bytes(bytes(row.at(-1) as string)));
    }
  });
}

it.each(["a2b_qp","b2a_qp"] as const)("%s preserves metadata",name=>{
  const fn=fixture().functions.get(name)!.value;
  expect(fn.doc).toBe(reference.metadata[name].doc);
  expect(fn.textSignature).toBe(reference.metadata[name].signature);
  expect(fn.module).toBe("binascii");
});

it.each(["a2b_qp","b2a_qp"])("%s pins buffers across ordered truth callbacks and observes mutation",name=>{
  const {values:v,invoke}=fixture(),events:string[]=[],source=v.cell({});let payload=v.bytes(bytes("413d46465f"));
  const flags=name==="a2b_qp"?[v.cell({})]:[v.cell({}),v.cell({}),v.cell({})];
  const context:BuiltinInvocationContext={call(){throw Error("unexpected call");},buffers:{acquireSimple(input){
    expect(input).toBe(source);events.push("acquire");return {byteLength:5,copy(){events.push("copy");return payload.value;},release(){events.push("release");}};
  }},truth(input){events.push(`truth ${flags.indexOf(input)}`);payload=v.bytes(bytes("423d46465f"));return true;}};
  expect(invoke(name,[source,...flags],context)).toEqual(v.bytes(bytes(name==="a2b_qp"?"42ff20":"423d334446463d3546")));
  expect(events).toEqual(["acquire",...flags.map((_,index)=>`truth ${index}`),"copy","release"]);
});

it.each(["a2b_qp","b2a_qp"])("%s cleans up guest failures and terminal cancellation at each service boundary",name=>{
  for(const phase of ["acquire","truth","copy","release"]){
    for(const mode of ["failure","cancel-return","cancel-throw"]){
      if(phase==="release"&&mode!=="cancel-return")continue; // Release is nonthrowing host cleanup by contract.
      const {values:v,invoke,controller}=fixture(),events:string[]=[],failure=new PythonRuntimeError("ValueError","guest failure");
      const step=(at:string)=>{events.push(at);if(at!==phase)return;if(mode!=="failure")controller.abort();if(mode!=="cancel-return")throw failure;};
      const context:BuiltinInvocationContext={call(){throw Error("unexpected call");},buffers:{acquireSimple(){step("acquire");return {byteLength:1,copy(){step("copy");return v.bytes(bytes("41")).value;},release(){step("release");}};}},truth(){step("truth");return true;}};
      const source=v.cell({}),flag=v.cell({}),run=()=>invoke(name,[source,flag],context);
      expect(run).toThrow(mode!=="failure"?ExecutionLimitError:phase==="acquire"&&name==="a2b_qp"?"argument should be bytes, buffer or ASCII string":failure);
      expect(events.filter(event=>event==="release")).toHaveLength(phase==="acquire"&&mode!=="cancel-return"?0:1);
      if(mode!=="failure"){expect(run).toThrow(ExecutionLimitError);expect(events.filter(event=>event==="acquire")).toHaveLength(1);}
    }
  }
});
