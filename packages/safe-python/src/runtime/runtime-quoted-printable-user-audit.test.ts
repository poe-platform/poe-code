import {expect,it} from "vitest";
import {createRuntimeQuotedPrintableFunctions} from "./runtime-quoted-printable-functions.js";
import {BinasciiError} from "./binascii-error.js";
import {ExecutionBudget} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeValues,type BuiltinInvocationContext,type RuntimeValue} from "./runtime-values.js";
import reference from "./__snapshots__/quoted-printable-native-binding-3.14.7.json";

function fixture(){
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal}),values=new RuntimeValues(meter);
  const keywords=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>0n,equal:(a,b)=>a===b},meter));
  const functions=new Map(createRuntimeQuotedPrintableFunctions(values,meter));
  const invoke=(name:string,args:RuntimeValue[],context?:BuiltinInvocationContext)=>functions.get(name)!.value.invoke(args,keywords,meter,context);
  return {controller,meter,values,keywords,functions,invoke};
}

it.each(reference.cases.map((row,index)=>({...row,index})))("pinned quoted-printable binding $index: $name",row=>{
  const {values:v,invoke,keywords,meter}=fixture();
  const value=(spec:unknown[]):RuntimeValue=>{
    switch(spec[0]){
      case "bytes":{const hex=spec[1] as string;return v.bytes(Uint8Array.from({length:hex.length/2},(_,i)=>Number.parseInt(hex.slice(i*2,i*2+2),16)));}
      case "str":return v.string(spec[1] as string);
      case "int":return v.integer(BigInt(spec[1] as string));
      case "none":return v.none;
      case "list":return v.list([]);
      default:throw Error("unknown oracle argument");
    }
  };
  for(const [key,input] of Object.entries(row.kwargs))keywords.items.set(v.string(key),value(input!));
  if(row.result.error==="Error"){
    // Module assembly must publish this internal fault as binascii.Error.
    expect(()=>invoke(row.name,row.args.map(value))).toThrow(BinasciiError);
    expect(()=>invoke(row.name,row.args.map(value))).toThrow(row.result.message);
    return;
  }
  let actual:unknown;
  try{
    const result=invoke(row.name,row.args.map(value));
    if(result.kind!=="bytes")throw Error("expected exact bytes");
    actual={hex:[...result.value.toUint8Array(meter)].map(x=>x.toString(16).padStart(2,"0")).join("")};
  }catch(error){actual={error:(error as Error).name,message:(error as Error).message};}
  expect(actual).toEqual(row.result);
});

