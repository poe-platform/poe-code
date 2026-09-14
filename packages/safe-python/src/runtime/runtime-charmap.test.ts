import {expect,it} from "vitest";
import {RuntimeCharmap} from "./runtime-charmap.js";
import {RuntimeValues,type BuiltinInvocationContext} from "./runtime-values.js";
import {ExecutionBudget} from "./execution-budget.js";
import {CodePointString} from "./code-point-string.js";
import {PythonRuntimeError} from "./error.js";
import reference from "./__snapshots__/charmap-protocol-3.14.7.json";
import type {Utf8EncodeErrors} from "./utf8-encode.js";

it("retains the first surrogateescape decode fault in exception arguments",()=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:2000000}),values=new RuntimeValues(meter);
  const context:BuiltinInvocationContext={isStopIteration:()=>false,call:()=>{throw Error("unexpected callback");}};
  let failure:unknown;
  try{new RuntimeCharmap(values,meter).decode(Uint8Array.from([255,97]),values.string("\ufffe".repeat(256)),"surrogateescape",context);}catch(error){failure=error;}
  expect(failure).toMatchObject({name:"UnicodeDecodeError",start:1,end:2,initial:{start:0,end:1,reason:"character maps to <undefined>"}});
});

it.each(["encode","decode"] as const)("matches pinned charmap %s mapping return values and lookup order",operation=>{
  for(const row of reference.cases.filter(row=>row.operation===operation)){
    const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:2000000}),values=new RuntimeValues(meter),events:number[]=[];
    const mapping=values.builtinFunction({name:"mapping",invoke:()=>values.none});
    const context:BuiltinInvocationContext={isStopIteration:()=>false,lookupSpecial:()=>mapping,isException:(error,name)=>error instanceof PythonRuntimeError&&(error.name===name||name==="LookupError"&&["KeyError","IndexError"].includes(error.name)),call:(_fn,args)=>{
      const key=Number(args[0].kind==="int"?args[0].value:NaN);events.push(key);
      if(key!==65&&key!==66)return values.integer(key);
      const value=row.mapping;
      if(value===null)return values.none;
      if("int" in value)return values.integer(BigInt(value.int!));
      if("text" in value)return values.stringPoints(new CodePointString(Uint32Array.from(value.text!)));
      if("bytes" in value)return values.bytes(Uint8Array.from(value.bytes!));
      if("bool" in value)return values.boolean(value.bool!);
      if("float" in value)return values.float(value.float!);
      throw new PythonRuntimeError(value.error as "LookupError"|"IndexError"|"ValueError","mapping failure");
    }};
    const codec=new RuntimeCharmap(values,meter),policy=row.policy as Utf8EncodeErrors;
    let actual:unknown;
    try{
      if(operation==="encode")actual={output:[...codec.encode(new CodePointString(Uint32Array.from(row.input)),mapping,policy,context)],consumed:row.input.length,events};
      else{const result=codec.decode(Uint8Array.from(row.input),mapping,policy,context);actual={output:[...result.text],consumed:result.consumed,events};}
    }catch(error){
      const failure=error as {name:string;message:string;encoding?:string;object?:Iterable<number>;start?:number;end?:number;reason?:string};
      actual={error:failure.name,message:failure.message,...(failure.encoding===undefined?{}:{encoding:failure.encoding,object:[...failure.object!],start:failure.start,end:failure.end,reason:failure.reason}),events};
    }
    expect(actual,JSON.stringify({operation,mapping:row.mapping,policy})).toEqual(row.expected);
  }
});

it.each(["surrogateescape","replace","backslashreplace","xmlcharrefreplace","namereplace"] as const)("preserves %s exception arguments when a later mapping fault fails",policy=>{
  const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:2000000}),values=new RuntimeValues(meter);
  let separators=0;
  const mapping=values.builtinFunction({name:"mapping",invoke:()=>values.none});
  const context:BuiltinInvocationContext={isStopIteration:()=>false,lookupSpecial:()=>mapping,call:(_fn,args)=>{
    const point=Number(args[0].kind==="int"?args[0].value:NaN);
    if(point===65){separators++;return values.integer(65);}
    if(point===0xdc80||point===0x10ffff)return values.none;
    return separators<2&&point<256?values.integer(point):values.none;
  }};
  let failure:unknown;
  try{new RuntimeCharmap(values,meter).encode(new CodePointString(Uint32Array.from([0xdc80,65,0x10ffff])),mapping,policy,context);}catch(error){failure=error;}
  expect(failure).toMatchObject({name:"UnicodeEncodeError",start:2,end:3});
  const retained=policy==="surrogateescape"||policy==="backslashreplace"||policy==="namereplace";
  expect((failure as {initial?:unknown}).initial).toEqual(retained?{start:0,end:1,reason:"character maps to <undefined>"}:undefined);
});
