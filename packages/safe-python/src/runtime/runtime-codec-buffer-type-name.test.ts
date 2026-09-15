import {expect,it} from "vitest";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";
import {createRuntimeBase64Functions} from "./runtime-base64-functions.js";
import {createRuntimeUuFunctions} from "./runtime-uu-functions.js";
import {createRuntimeQuotedPrintableFunctions} from "./runtime-quoted-printable-functions.js";
import {createRuntimeHexadecimalFunctions} from "./runtime-hexadecimal-functions.js";
import {createRuntimeCrcFunctions} from "./runtime-crc-functions.js";
import reference from "./__snapshots__/codec-buffer-type-name-3.14.7.json";

it.each(reference.cases)("$name reports the buffer provider's type $typename",row=>{
  for(const withGeneralName of [false,true]){
    const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),values=new RuntimeValues(meter);
    const keywords=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>0n,equal:(a,b)=>a===b},meter));
    const functions=new Map([
      ...createRuntimeBase64Functions(values,meter),...createRuntimeUuFunctions(values,meter),
      ...createRuntimeQuotedPrintableFunctions(values,meter),...createRuntimeHexadecimalFunctions(values,meter),
      ...createRuntimeCrcFunctions(values,meter)
    ]);
    const source=values.cell({});let acquisitions=0;
    const context:BuiltinInvocationContext={
      call(){throw Error("unexpected guest call");},
      ...(withGeneralName?{typeName:()=>"GenericWrapper"}:{}),
      buffers:{
        acquireSimple(input){expect(input).toBe(source);acquisitions++;return undefined;},
        typeName(input){expect(input).toBe(source);return row.typename;}
      }
    };
    let actual:unknown;
    try{
      functions.get(row.name)!.value.invoke([source,...(row.name==="crc_hqx"?[values.integer(0)]:[])],keywords,meter,context);
      actual="unexpected success";
    }catch(error){actual={error:(error as Error).name,message:(error as Error).message};}
    expect(actual).toEqual({error:row.error,message:row.message});
    expect(acquisitions).toBe(1);
  }
});

it.each(["crc32","crc_hqx"])("%s preserves type-name failures and terminal cancellation",name=>{
  for(const cancel of [false,true])for(const throws of [false,true]){
    const controller=new AbortController();
    const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal}),values=new RuntimeValues(meter);
    const keywords=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>0n,equal:(a,b)=>a===b},meter));
    const fn=new Map(createRuntimeCrcFunctions(values,meter)).get(name)!;
    const source=values.cell({}),args=[source,values.integer(0)],failure=new PythonRuntimeError("ValueError","type metadata failure");
    const events:string[]=[];
    const context:BuiltinInvocationContext={call(){throw Error("unexpected guest call");},buffers:{
      acquireSimple(){events.push("acquire");return undefined;},
      typeName(){events.push("type");if(cancel)controller.abort();if(throws)throw failure;return "Payload";}
    }};
    const run=()=>fn.value.invoke(args,keywords,meter,context);
    expect(run).toThrow(cancel?ExecutionLimitError:throws?failure:"a bytes-like object is required, not 'Payload'");
    expect(events).toEqual(["acquire","type"]);
    if(cancel){expect(run).toThrow(ExecutionLimitError);expect(events).toEqual(["acquire","type"]);}
  }
});
