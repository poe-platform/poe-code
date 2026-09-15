import {expect,it} from "vitest";
import {SingleByteTableCodec} from "./single-byte-table-codec.js";
import {singleByteTables} from "./single-byte-tables.js";
import reference from "./__snapshots__/single-byte-tables-3.14.7.json";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {unicodeCodecName} from "../unicode-codec-name.js";
import type {Utf8EncodeErrors} from "./utf8-encode.js";

const text=(points:readonly number[])=>new CodePointString(Uint32Array.from(points));
const budget=(signal?:AbortSignal)=>new ExecutionBudget({maxSteps:200000,maxAllocatedBytes:4000000,signal});
const tables=new Map(singleByteTables.map(table=>[table.name,table]));

it("retains cp424 surrogateescape decode arguments after recovering an undefined high byte",()=>{
  const meter=budget(),codec=new SingleByteTableCodec(tables.get("cp424")!,meter);
  let failure:unknown;
  try{codec.decode(Uint8Array.from([128,112]),"surrogateescape",meter);}catch(error){failure=error;}
  expect(failure).toMatchObject({name:"UnicodeDecodeError",start:1,end:2,initial:{start:0,end:1,reason:"character maps to <undefined>"}});
});

it.each(singleByteTables)("matches the pinned $name mapping and all recovery policies",table=>{
  const meter=budget(),codec=new SingleByteTableCodec(table,meter);
  for(const row of reference.cases.filter(row=>row.name===table.name)){
    const meter=budget(),policy=row.policy as Utf8EncodeErrors;
    let actual:unknown;
    try{
      if(row.operation==="encode")actual={output:[...codec.encode(text(row.input),policy,meter,point=>unicodeCodecName(point,meter))],consumed:row.input.length};
      else{
        const result=codec.decode(Uint8Array.from(row.input),policy,meter);
        actual={output:[...result.text],consumed:result.consumed};
      }
    }catch(error){
      const failure=error as {name:string;encoding?:string;object?:Iterable<number>;start?:number;end?:number;reason?:string;message:string};
      actual=failure.encoding===undefined?{error:failure.name,message:failure.message}:{error:failure.name,encoding:failure.encoding,object:[...failure.object!],start:failure.start,end:failure.end,reason:failure.reason};
    }
    expect(actual,`${row.name} ${row.operation} ${row.policy} ${row.input.length}`).toEqual(row.expected);
  }
});

it("decodes replaced input while reporting original consumption",()=>{
  const meter=budget(),codec=new SingleByteTableCodec(tables.get("cp1252")!,meter);
  expect(codec.decode(new Uint8Array([129,65]),()=>({replacement:text([63]),input:new Uint8Array([66,67,68]),position:1}),meter)).toEqual({text:text([63,67,68]),consumed:2});
});

it("remaps text replacements, permits raw bytes and retains rejected error identity",()=>{
  const meter=budget(),codec=new SingleByteTableCodec(tables.get("cp1252")!,meter),failure=new Error("guest exception");
  expect(codec.encode(text([256]),()=>({replacement:text([8364]),position:1}),meter)).toEqual(new Uint8Array([128]));
  expect(codec.encode(text([256]),()=>({replacement:new Uint8Array([129]),position:1}),meter)).toEqual(new Uint8Array([129]));
  expect(()=>codec.encode(text([256]),()=>({replacement:text([257]),position:1,failure}),meter)).toThrow(failure);
});

it.each(["encode","decode"] as const)("cancellation dominates %s callback failures",operation=>{
  const controller=new AbortController(),meter=budget(controller.signal),codec=new SingleByteTableCodec(tables.get("cp1252")!,meter);
  const callback=()=>{controller.abort();throw new Error("guest failure");};
  expect(()=>operation==="encode"?codec.encode(text([256]),callback,meter):codec.decode(new Uint8Array([129]),callback,meter)).toThrow(ExecutionLimitError);
});
