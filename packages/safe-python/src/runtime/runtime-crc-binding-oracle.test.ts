import {expect,it} from "vitest";
import {createRuntimeCrcFunctions} from "./runtime-crc-functions.js";
import {ExecutionBudget} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeValues,type RuntimeValue} from "./runtime-values.js";
import reference from "./__snapshots__/crc-native-binding-3.14.7.json";

// The retained driver uses Python only as an external differential oracle.
// Unit tests replay its results through the actual native bindings and kernels.
it.each(reference.cases.map((row,index)=>({...row,index})))("pinned CRC binding $index: $name",row=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000}),values=new RuntimeValues(meter);
  const keywords=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>({hash:()=>0n,equal:(a,b)=>a===b},meter));
  const functions=new Map(createRuntimeCrcFunctions(values,meter));
  const value=(spec:unknown[]):RuntimeValue=>{
    switch(spec[0]){
      case "bytes":{const hex=spec[1] as string;return values.bytes(Uint8Array.from({length:hex.length/2},(_,i)=>Number.parseInt(hex.slice(i*2,i*2+2),16)));}
      case "str":return values.string(spec[1] as string);
      case "int":return values.integer(BigInt(spec[1] as string));
      case "float":return values.float(spec[1] as number);
      case "bool":return values.boolean(spec[1] as boolean);
      case "none":return values.none;
      case "list":return values.list([]);
      default:throw Error("unknown oracle argument");
    }
  };
  for(const [key,input] of Object.entries(row.kwargs))keywords.items.set(values.string(key),value(input!));
  const callable=functions.get(row.name)!.value;
  expect(callable).toMatchObject({module:"binascii",...reference.metadata[row.name as keyof typeof reference.metadata]});
  let actual:unknown;
  try{
    const result=callable.invoke(row.args.map(value),keywords,meter);
    if(result.kind!=="int")throw Error("expected exact int");
    actual={integer:String(result.value)};
  }catch(error){actual={error:(error as Error).name,message:(error as Error).message};}
  expect(actual).toEqual(row.result);
});
