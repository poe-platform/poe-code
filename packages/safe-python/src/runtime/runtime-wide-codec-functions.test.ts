import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {ImmutableBytes} from "./immutable-bytes.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {createRuntimeWideCodecFunctions} from "./runtime-wide-codec-functions.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";

for(const width of [16,32]){
  it.each(["ok","invalid-errors","invalid-order","overflow-order","invalid-final","copy-failure","acquire-failure","cancel-acquire","cancel-order","cancel-final","cancel-copy"])(`holds UTF-${width} buffer exports through argument callbacks and decoding: %s`,mode=>{
    const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
    const values=new RuntimeValues(meter),registry=new RuntimeCodecRegistry(values,meter);
    const empty=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>0n,equal:(a,b)=>a===b},meter));
    const source=values.cell({}),order=values.cell({}),final=values.cell({}),events:string[]=[];
    let data=Array.from({length:width/8},(_,index)=>index===0?65:0);
    const truth=values.builtinFunction({name:"__bool__",invoke:()=>{
      events.push("final");data[0]=66;
      if(mode==="invalid-final")throw Error("final failed");
      if(mode==="cancel-final")controller.abort();
      return values.true;
    }});
    const fn=createRuntimeWideCodecFunctions(registry).get(`utf_${width}_ex_decode`)!;
    const invoke=()=>fn.value.invoke([source,mode==="invalid-errors"?values.integer(42):values.none,order,final],empty,meter,{
      call:()=>truth.value.invoke([],empty,meter),
      lookupSpecial:(value,name)=>value===final&&name==="__bool__"?truth:undefined,
      integerIndex:{
        integer:value=>value.kind==="int"?value.value:undefined,isExactInteger:value=>value.kind==="int",typeName:value=>value.kind,
        warn:()=>{throw Error("unexpected warning");},
        lookupIndex:value=>value===order?()=>{
          events.push("order");
          if(mode==="invalid-order")throw Error("order failed");
          if(mode==="cancel-order")controller.abort();
          return values.integer(mode==="overflow-order"?2147483648n:-2n);
        }:undefined,
      },
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
      expect(invoke()).toEqual(values.tuple([values.string("B"),values.integer(width/8),values.integer(-2)]));
      expect(events).toEqual(["acquire","order","final","copy","release"]);
    }else{
      const failures:Record<string,string>={
        "invalid-errors":`utf_${width}_ex_decode() argument 2 must be str or None, not int`,
        "invalid-order":"order failed","overflow-order":"Python int too large to convert to C int",
        "invalid-final":"final failed","copy-failure":"copy failed","acquire-failure":"acquire failed",
      };
      expect(invoke).toThrow(mode.startsWith("cancel")?ExecutionLimitError:failures[mode]);
      const expected=["acquire"];
      if(mode!=="acquire-failure"){
        if(!["invalid-errors","cancel-acquire"].includes(mode))expected.push("order");
        if(["invalid-final","cancel-final","copy-failure","cancel-copy"].includes(mode))expected.push("final");
        if(["copy-failure","cancel-copy"].includes(mode))expected.push("copy");
        expected.push("release");
      }
      expect(events).toEqual(expected);
    }
  });
}
