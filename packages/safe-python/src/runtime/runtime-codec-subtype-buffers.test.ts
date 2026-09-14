import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import {ImmutableBytes} from "./immutable-bytes.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {createRuntimeCoreCodecFunctions} from "./runtime-core-codec-functions.js";
import {createRuntimeWideCodecFunctions} from "./runtime-wide-codec-functions.js";
import {createRuntimeNativeBuffers} from "./runtime-native-buffers.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeTypeLayout} from "./runtime-type-layout.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";

// Service-boundary regressions, not certification of public memoryview or
// __buffer__ publication. The unchanged public buffer gates remain required.
const operations=[
  "ascii_decode","latin_1_decode","utf_8_decode","utf_7_decode",
  "charmap_decode","unicode_escape_decode","raw_unicode_escape_decode",
  "utf_16_decode","utf_16_le_decode","utf_16_be_decode","utf_16_ex_decode",
  "utf_32_decode","utf_32_le_decode","utf_32_be_decode","utf_32_ex_decode",
  "escape_decode","readbuffer_encode"
];

function fixture(){
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:4000000,signal:controller.signal});
  const values=new RuntimeValues(meter),keys={hash:()=>0n,equal:(a:RuntimeValue,b:RuntimeValue)=>a===b};
  const types=new RuntimeTypeRegistry(values,keys,meter),registry=new RuntimeCodecRegistry(values,meter);
  const bytes=values.bytes(Uint8Array.of(87,82,79,78,71));
  const empty=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(keys,meter));
  const subtype=types.publish(new RuntimeTypeLayout("Export",[types.bytesType().value],empty,meter),types.type);
  const source=values.instance(subtype,undefined,bytes);
  const functions=new Map([...createRuntimeCoreCodecFunctions(registry),...createRuntimeWideCodecFunctions(registry)]);
  return {controller,meter,values,source,bytes,empty,functions};
}

it.each(operations)("%s honors subtype exports before later argument validation and releases them",name=>{
  for(const mode of ["ok","bad-errors","acquire-failure","copy-failure","cancel-acquire","cancel-copy"]){
    const {controller,meter,values,source,empty,functions}=fixture(),events:string[]=[];
    const failure=new PythonRuntimeError("ValueError","export failed");
    const buffers=createRuntimeNativeBuffers(meter,{acquireSimple(value){
      expect(value).toBe(source);events.push("acquire");
      if(mode==="acquire-failure")throw failure;
      if(mode==="cancel-acquire")controller.abort();
      return {object:source,byteLength:0,copy(){
        events.push("copy");
        if(mode==="copy-failure")throw failure;
        if(mode==="cancel-copy")controller.abort();
        return ImmutableBytes.copyOf([],meter);
      },release(){events.push("release");}};
    }});
    const invoke=()=>functions.get(name)!.value.invoke([source,mode==="bad-errors"||mode==="acquire-failure"?values.integer(42):values.none],empty,meter,{call:()=>{throw Error("unexpected guest call");},buffers});
    if(mode==="ok"){
      const result=invoke();
      const expected=[name==="escape_decode"||name==="readbuffer_encode"?values.bytes(new Uint8Array()):values.string(""),values.integer(0)];
      if(name.includes("_ex_"))expected.push(values.integer(0));
      expect(result,name).toEqual(values.tuple(expected));
    }else if(mode==="bad-errors")expect(invoke).toThrow(`${name}() argument 2 must be str or None, not int`);
    else if(mode.startsWith("cancel"))expect(invoke).toThrow(ExecutionLimitError);
    else expect(invoke).toThrow(failure);
    expect(events,`${name}: ${mode}`).toEqual(mode==="acquire-failure"?["acquire"]:mode==="bad-errors"||mode==="cancel-acquire"?["acquire","release"]:["acquire","copy","release"]);
  }
});

it.each(["simple","full"] as const)("offers native subtypes to %s export services and preserves native fallback",mode=>{
  const {meter,source,bytes}=fixture(),seen:RuntimeValue[]=[];
  const extension={acquireSimple(value:RuntimeValue){seen.push(value);return undefined;}};
  const buffers=createRuntimeNativeBuffers(meter,extension);
  const acquire=mode==="simple"?buffers.acquireSimple:buffers.acquireFull!;
  for(const value of [source,bytes]){
    const lease=acquire(value)!;
    expect(lease.object).toBe(value);
    expect(lease.copy()).toBe(bytes.value);
    lease.release();lease.release();
    expect(()=>lease.copy()).toThrow("buffer lease was released");
  }
  expect(seen).toEqual([source]);
});

it("preserves the full-buffer service choice for native subtypes",()=>{
  const {meter,source,bytes}=fixture();
  const lease={byteLength:bytes.value.length,copy:()=>bytes.value,release(){}};
  const buffers=createRuntimeNativeBuffers(meter,{acquireSimple(){throw Error("simple export requested");},acquireFull(value){expect(value).toBe(source);return lease;}});
  expect(buffers.acquireFull!(source)).toBe(lease);
});

it.each([...operations,"escape_encode"])("%s retains the native exact-bytes path",name=>{
  const {meter,values,bytes,source,empty,functions}=fixture();
  const buffers=createRuntimeNativeBuffers(meter,{acquireSimple(){throw Error("unexpected export override");}});
  const value=name==="escape_encode"?source:values.bytes(new Uint8Array());
  const result=functions.get(name)!.value.invoke([value],empty,meter,{call:()=>{throw Error("unexpected guest call");},buffers});
  const expected=name==="escape_encode"?[values.bytes(bytes.value),values.integer(5)]:[name==="escape_decode"||name==="readbuffer_encode"?values.bytes(new Uint8Array()):values.string(""),values.integer(0)];
  if(name.includes("_ex_"))expected.push(values.integer(0));
  expect(result).toEqual(values.tuple(expected));
});
