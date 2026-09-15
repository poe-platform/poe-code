import {expect,it} from "vitest";
import reference from "./__snapshots__/unicode-escape-3.14.7.json";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {decodeUnicodeEscape,encodeUnicodeEscape,UnicodeEscapeDecoder} from "./unicode-escape.js";

it("matches pinned escape decoding, consumed bytes, error spans and warnings",()=>{
  expect(reference.oracle.unicode).toBe("16.0.0");
  for(const row of reference.decode){
    const warnings:string[][]=[];
    let actual:unknown;
    try {
      const result=decodeUnicodeEscape(new Uint8Array(row.input),row.raw,row.errors as "strict",undefined,row.final,warning=>warnings.push(["DeprecationWarning",warning]));
      actual={result:[[...result.text],result.consumed],warnings};
    }catch(error){
      if(!(error instanceof PythonDecodeError))throw error;
      actual={error:[error.encoding,[...error.object],error.start,error.end,error.reason],warnings};
    }
    expect(actual,JSON.stringify(row)).toEqual(row.result===undefined?{error:row.error,warnings:row.warnings}:{result:row.result,warnings:row.warnings});
  }
});

it("matches pinned escape encoders for byte values, all surrogate edges and astral points",()=>{
  for(const row of reference.encode)expect([...encodeUnicodeEscape(new CodePointString(new Uint32Array(row.input)),row.raw)]).toEqual(row.result);
});

it("matches every split boundary including octal chunk dependence and state after failure",()=>{
  for(const row of reference.incremental){
    const warnings:string[][]=[];
    const decoder=new UnicodeEscapeDecoder(row.raw,row.errors as "strict",warning=>warnings.push(["DeprecationWarning",warning]));
    const input=new Uint8Array(row.input);
    for(const [index,chunk] of [input.slice(0,row.split),input.slice(row.split)].entries()){
      warnings.length=0;
      let actual:Record<string,unknown>;
      try {actual={result:[...decoder.decode(chunk,index===1)]};}
      catch(error){
        if(!(error instanceof PythonDecodeError))throw error;
        actual={error:[error.encoding,[...error.object],error.start,error.end,error.reason]};
      }
      const [pending,flag]=decoder.getstate();actual.state=[[...pending],Number(flag)];actual.warnings=warnings;
      expect(actual,JSON.stringify({row,index})).toEqual(row.calls[index]);
    }
  }
});

it("copies restored state and preserves it when the warning service raises",()=>{
  const decoder=new UnicodeEscapeDecoder(false,"strict",()=>{throw Error("warning promoted to error");});
  const pending=new Uint8Array([92]);decoder.setstate([pending,123n]);pending[0]=65;
  decoder.getstate()[0][0]=65;
  expect(()=>decoder.decode(new Uint8Array([113]),true)).toThrow("warning promoted to error");
  expect(decoder.getstate()).toEqual([new Uint8Array([92]),0n]);
  decoder.reset();expect(decoder.getstate()).toEqual([new Uint8Array(),0n]);
});

it("resumes in callback-replaced input and grows long replacements",()=>{
  const replacement=new CodePointString(new Uint32Array(100).fill(63));
  const result=decodeUnicodeEscape(new Uint8Array([65,92,117,81]),false,error=>{
    expect(error).toMatchObject({encoding:"unicodeescape",start:1,end:3,reason:"truncated \\uXXXX escape"});
    return {replacement,position:1,input:new Uint8Array([0,90])};
  },undefined,true,()=>{throw Error("unexpected warning");});
  expect([...result.text]).toEqual([65,...replacement,90]);expect(result.consumed).toBe(4);
});

it.each([false,true])("cancellation dominates callback completion (throws=%s)",throws=>{
  for(const warning of [false,true]){
    const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:10000,maxAllocatedBytes:10000,signal:controller.signal});
    const abort=()=>{controller.abort();if(throws)throw Error("callback failure");};
    expect(()=>decodeUnicodeEscape(new Uint8Array(warning?[92,113]:[92,117]),false,()=>{
      abort();return {replacement:new CodePointString(new Uint32Array()),position:2,input:new Uint8Array([92,117])};
    },meter,true,abort)).toThrow(ExecutionLimitError);
  }
});

it("meters non-advancing recovery and input before allocating",()=>{
  const bytes=new Uint8Array([92,117]),meter=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:100000});
  expect(()=>decodeUnicodeEscape(bytes,false,()=>({replacement:new CodePointString(new Uint32Array()),position:0,input:bytes}),meter,true,()=>{})).toThrow(ExecutionLimitError);
  const controller=new AbortController();controller.abort();
  expect(()=>encodeUnicodeEscape(new CodePointString(new Uint32Array([65])),false,new ExecutionBudget({maxSteps:100,maxAllocatedBytes:1000,signal:controller.signal}))).toThrow(ExecutionLimitError);
});
