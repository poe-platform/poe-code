import {expect,it,vi} from "vitest";
import {ExecutionBudget} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {createRuntimeStringEncodeMethod} from "./runtime-string-encode-method.js";
import {createRuntimeStringDecoder} from "./runtime-string-decoding.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeTypeLayout} from "./runtime-type-layout.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";

function fixture(){
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:2000000}),values=new RuntimeValues(meter);
  const keys={hash:()=>1n,equal:(a:RuntimeValue,b:RuntimeValue)=>a===b};
  const dictionary=()=>values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(keys,meter));
  const types=new RuntimeTypeRegistry(values,keys,meter);
  const type=types.publish(new RuntimeTypeLayout("Result",[types.object.value],dictionary(),meter),types.type);
  return {meter,values,dictionary,type};
}

// These are consumer-boundary tests, not public codecs-module evidence. Native
// subtype payloads are supplied explicitly until canonical bytes is published.
it.each(["encode","decode"] as const)("%s applies its native subtype result policy without guest conversions",operation=>{
  const {meter,values,dictionary,type}=fixture();
  const native=operation==="encode"?values.bytes(new Uint8Array([65])):values.string("A");
  const result=values.instance(type,undefined,native),call=vi.fn(()=>{throw Error("unexpected guest conversion");});
  const actual=operation==="encode"
    ?createRuntimeStringEncodeMethod(values.string("x"),values,meter,()=>result).value.invoke([values.string("custom")],dictionary(),meter,{call})
    :createRuntimeStringDecoder(()=>result,values)(values.bytes(new Uint8Array([120])),"custom","strict",meter,{call});
  if(operation==="encode")expect(actual).toBe(result);
  else {expect(actual.kind).toBe("str");expect(actual).toEqual(native);expect(actual).not.toBe(result);}
  expect(call).not.toHaveBeenCalled();
});

it.each(["encode","decode"] as const)("%s reports an exact guest TypeError for a wrong codec result",operation=>{
  const {meter,values,dictionary}=fixture();
  const result=operation==="encode"?values.string("bad"):values.bytes(new Uint8Array([65]));
  const invoke=()=>operation==="encode"
    ?createRuntimeStringEncodeMethod(values.string("x"),values,meter,()=>result).value.invoke([values.string("CuStOm")],dictionary(),meter)
    :createRuntimeStringDecoder(()=>result,values)(values.bytes(new Uint8Array([120])),"CuStOm","strict",meter,undefined);
  expect(invoke).toThrow(new PythonRuntimeError("TypeError",`'CuStOm' ${operation}r returned '${result.kind}' instead of '${operation==="encode"?"bytes":"str"}'; use codecs.${operation}() to ${operation} to arbitrary types`));
});

it.each(["encode","decode"] as const)("%s bounds both diagnostic fields by 400 UTF-8 bytes",operation=>{
  const {meter,values,dictionary,type}=fixture(),result=values.instance(type),name="é".repeat(199)+"💥",typeName=()=>"€".repeat(133)+"💥";
  const invoke=()=>operation==="encode"
    ?createRuntimeStringEncodeMethod(values.string("x"),values,meter,()=>result).value.invoke([values.string(name)],dictionary(),meter,{call:vi.fn(),typeName})
    :createRuntimeStringDecoder(()=>result,values)(values.bytes(new Uint8Array([120])),name,"strict",meter,{call:vi.fn(),typeName});
  expect(invoke).toThrow(new PythonRuntimeError("TypeError",`'${"é".repeat(199)}' ${operation}r returned '${"€".repeat(133)}' instead of '${operation==="encode"?"bytes":"str"}'; use codecs.${operation}() to ${operation} to arbitrary types`));
});

it("validates decoder output while the input buffer is leased and releases it on failure",()=>{
  const {meter,values}=fixture(),events:string[]=[],bytes=values.bytes(new Uint8Array([120])).value;
  const decode=createRuntimeStringDecoder(()=>{events.push("decode");return values.none;},values);
  expect(()=>decode(values.cell({}),"custom","strict",meter,{call:vi.fn(),typeName:()=>{events.push("type");return "NoneType";},buffers:{acquireSimple:()=>({byteLength:1,copy:()=>bytes,release:()=>{events.push("release");}})}})).toThrow("decoder returned 'NoneType'");
  expect(events).toEqual(["decode","type","release"]);
});

it("reports native bytes results without requiring canonical bytes type publication",()=>{
  const {meter,values}=fixture(),typeName=vi.fn(()=>{throw Error("canonical bytes type is unavailable");});
  const decode=createRuntimeStringDecoder(()=>values.bytes(new Uint8Array([65])),values);
  expect(()=>decode(values.bytes(new Uint8Array([120])),"custom","strict",meter,{call:vi.fn(),typeName})).toThrow(new PythonRuntimeError("TypeError","'custom' decoder returned 'bytes' instead of 'str'; use codecs.decode() to decode to arbitrary types"));
  expect(typeName).not.toHaveBeenCalled();
});
