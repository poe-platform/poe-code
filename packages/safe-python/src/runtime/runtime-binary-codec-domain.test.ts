import {expect,it} from "vitest";
import {ExecutionBudget} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";
import {createRuntimeBase64Functions} from "./runtime-base64-functions.js";
import {createRuntimeUuFunctions} from "./runtime-uu-functions.js";
import {createRuntimeQuotedPrintableFunctions} from "./runtime-quoted-printable-functions.js";
import {createRuntimeHexadecimalFunctions} from "./runtime-hexadecimal-functions.js";
import {createRuntimeCrcFunctions} from "./runtime-crc-functions.js";
import reference from "./__snapshots__/binary-codec-domain-3.14.7.json";

// Exercise each native argument boundary with and without an explicit buffer
// provider. No guest type-name service is required for native singleton values.
it.each(reference.cases)("$name rejects $input with the pinned Python diagnostic",row=>{
  for(const installed of [false,true]){
    const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),values=new RuntimeValues(meter);
    const keywords=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>0n,equal:(a,b)=>a===b},meter));
    const functions=new Map([
      ...createRuntimeBase64Functions(values,meter),...createRuntimeUuFunctions(values,meter),
      ...createRuntimeQuotedPrintableFunctions(values,meter),...createRuntimeHexadecimalFunctions(values,meter),
      ...createRuntimeCrcFunctions(values,meter)
    ]);
    const inputs:Record<string,RuntimeValue>={
      NotImplemented:values.notImplemented,None:values.none,"...":values.ellipsis,"42":values.integer(42),"[]":values.list([]),
      len:values.builtinFunction({name:"len",invoke(){throw Error("input must not be called");}})
    };
    let acquisitions=0;
    const context:BuiltinInvocationContext|undefined=installed?{
      call(){throw Error("input must not be called");},
      buffers:{acquireSimple(input){expect(input).toBe(inputs[row.input]);acquisitions++;return undefined;}}
    }:undefined;
    let actual:unknown;
    try{
      functions.get(row.name)!.value.invoke([inputs[row.input],...(row.name==="crc_hqx"?[values.integer(0)]:[])],keywords,meter,context);
      actual="unexpected success";
    }catch(error){actual={error:(error as Error).name,message:(error as Error).message};}
    expect(actual).toEqual({error:row.error,message:row.message});
    expect(acquisitions).toBe(installed?1:0);
  }
});
