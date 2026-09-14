import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {ImmutableBytes} from "./immutable-bytes.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {createRuntimeCoreCodecFunctions} from "./runtime-core-codec-functions.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";

// Service-boundary unit tests. Public bytearray/memoryview integration and
// mutation of live buffer exports remain separate compatibility requirements.
it.each(["ok","invalid-errors","copy-failure","acquire-failure","cancel-acquire","cancel-copy"])("releases charmap decoder buffer exports: %s",mode=>{
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
  const values=new RuntimeValues(meter),registry=new RuntimeCodecRegistry(values,meter);
  const empty=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>0n,equal:(a,b)=>a===b},meter));
  const source=values.cell({}),events:string[]=[];
  const fn=createRuntimeCoreCodecFunctions(registry).get("charmap_decode")!;
  const invoke=()=>fn.value.invoke([source,mode==="invalid-errors"?values.integer(42):values.none,values.string("x".repeat(256))],empty,meter,{
    call:()=>{throw Error("unexpected guest coercion");},
    buffers:{acquireSimple(value){
      expect(value).toBe(source);events.push("acquire");
      if(mode==="acquire-failure")throw Error("acquire failed");
      if(mode==="cancel-acquire")controller.abort();
      return {byteLength:3,copy(){
        events.push("copy");
        if(mode==="copy-failure")throw Error("copy failed");
        if(mode==="cancel-copy")controller.abort();
        return ImmutableBytes.copyOf([0,128,255],meter);
      },release(){events.push("release");}};
    }},
  });
  if(mode==="ok"){
    expect(invoke()).toEqual(values.tuple([values.string("xxx"),values.integer(3)]));
    expect(events).toEqual(["acquire","copy","release"]);
  }else{
    const failures:Record<string,string>={"invalid-errors":"charmap_decode() argument 2 must be str or None, not int","copy-failure":"copy failed","acquire-failure":"acquire failed"};
    expect(invoke).toThrow(mode.startsWith("cancel")?ExecutionLimitError:failures[mode]);
    expect(events).toEqual(mode==="acquire-failure"?["acquire"]:mode==="invalid-errors"||mode==="cancel-acquire"?["acquire","release"]:["acquire","copy","release"]);
  }
});
