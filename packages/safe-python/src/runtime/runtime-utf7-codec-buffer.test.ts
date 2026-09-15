import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {ImmutableBytes} from "./immutable-bytes.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {createRuntimeCoreCodecFunctions} from "./runtime-core-codec-functions.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";

// Explicit service-boundary unit coverage; the public memoryview/bytearray
// types and supported service adapters remain required compatibility gates.
it.each(["ok","invalid-errors","invalid-final","copy-failure","acquire-failure","cancel-acquire","cancel-final","cancel-copy"])("holds UTF-7 buffer exports through argument callbacks and decoding: %s",mode=>{
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  const values=new RuntimeValues(meter),registry=new RuntimeCodecRegistry(values,meter);
  const empty=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>0n,equal:(a,b)=>a===b},meter));
  const source=values.cell({}),final=values.cell({}),events:string[]=[];
  let data=[65];
  const truth=values.builtinFunction({name:"__bool__",invoke:()=>{
    events.push("final");data[0]=66;
    if(mode==="invalid-final")throw Error("final failed");
    if(mode==="cancel-final")controller.abort();
    return values.true;
  }});
  const fn=createRuntimeCoreCodecFunctions(registry).get("utf_7_decode")!;
  const invoke=()=>fn.value.invoke([source,mode==="invalid-errors"?values.integer(42):values.none,final],empty,meter,{
    call:()=>truth.value.invoke([],empty,meter),
    lookupSpecial:(value,name)=>value===final&&name==="__bool__"?truth:undefined,
    buffers:{acquireSimple(value){
      expect(value).toBe(source);events.push("acquire");
      if(mode==="acquire-failure")throw Error("acquire failed");
      if(mode==="cancel-acquire")controller.abort();
      return {byteLength:data.length,copy(){
        events.push("copy");
        if(mode==="copy-failure")throw Error("copy failed");
        if(mode==="cancel-copy")controller.abort();
        return ImmutableBytes.copyOf(data,meter);
      },release(){events.push("release");data=[];}};
    }},
  });
  if(mode==="ok"){
    expect(invoke()).toEqual(values.tuple([values.string("B"),values.integer(1)]));
    expect(events).toEqual(["acquire","final","copy","release"]);
  }else{
    const failures:Record<string,string>={
      "invalid-errors":"utf_7_decode() argument 2 must be str or None, not int",
      "invalid-final":"final failed","copy-failure":"copy failed","acquire-failure":"acquire failed",
    };
    expect(invoke).toThrow(mode.startsWith("cancel")?ExecutionLimitError:failures[mode]);
    const expected=["acquire"];
    if(mode!=="acquire-failure"){
      if(!["invalid-errors","cancel-acquire"].includes(mode))expected.push("final");
      if(["copy-failure","cancel-copy"].includes(mode))expected.push("copy");
      expected.push("release");
    }
    expect(events).toEqual(expected);
  }
});
