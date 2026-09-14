import {expect,it} from "vitest";
import reference from "./__snapshots__/utf-wide-3.14.7.json";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonEncodeError} from "./encode-error.js";
import {decodeWideUnicode,encodeWideUnicode} from "./utf-wide.js";
import type {Utf8DecodeErrors} from "./utf8-decode.js";
import type {Utf8EncodeErrors} from "./utf8-encode.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";

it("matches the pinned CPython UTF-16/32 decoder values, consumption, byte order and errors",()=>{
  expect(reference.oracle.unicode).toBe("16.0.0");
  expect(reference.oracle.byteorder).toBe("little");
  for(const sample of reference.decode){
    let actual:unknown;
    try {
      const result=decodeWideUnicode(new Uint8Array(sample.input),sample.width as 16|32,sample.order as -1|0|1,sample.errors as Utf8DecodeErrors,undefined,sample.final);
      actual={result:[[...result.text],result.consumed,result.byteorder]};
    }catch(error){
      if(!(error instanceof PythonDecodeError))throw error;
      expect([...error.object]).toEqual(sample.input);
      actual={error:[error.encoding,error.start,error.end,error.reason]};
    }
    expect(actual,JSON.stringify(sample)).toEqual(sample.result===undefined?{error:sample.error}:{result:sample.result});
  }
});

it("resumes decoding in a replacement byte object and grows output for callback text",()=>{
  const replacement=new CodePointString(new Uint32Array(80).fill(63));
  const input=new Uint8Array([0,0xdc]);
  const result=decodeWideUnicode(input,16,-1,error=>{
    expect(error).toMatchObject({encoding:"utf-16-le",start:0,end:2,reason:"illegal encoding"});
    return {replacement,position:2,input:new Uint8Array([0,0,65,0])};
  });
  expect([...result.text]).toEqual([...replacement,65]);expect(result.consumed).toBe(2);
});

it("accepts aligned raw encoder replacement bytes and only ASCII replacement text",()=>{
  const input=new CodePointString(new Uint32Array([0xd800,65]));
  for(const width of [16,32] as const){
    const replacement=new Uint8Array(width/8).fill(255);
    expect(encodeWideUnicode(input,width,-1,()=>({replacement,position:1}))).toEqual(new Uint8Array([...replacement,...encodeWideUnicode(new CodePointString(new Uint32Array([65])),width,-1)]));
    for(const bad of [new Uint8Array([0]),...[0x80,0xe9,0x20ac,0x1f600,0xd800].map(point=>new CodePointString(new Uint32Array([point])))]){
      expect(()=>encodeWideUnicode(input,width,-1,()=>({replacement:bad,position:1}))).toThrow(expect.objectContaining({encoding:`utf-${width}-le`,start:0,end:1,reason:"surrogates not allowed"}));
    }
    const long=new CodePointString(new Uint32Array(80).fill(0x7f));
    expect(encodeWideUnicode(input,width,-1,()=>({replacement:long,position:2}))).toEqual(encodeWideUnicode(long,width,-1));
  }
});

it.each([false,true])("cancellation dominates callback returns and failures (throws=%s)",throws=>{
  for(const operation of ["encode","decode"]){
    const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:100000,signal:controller.signal});
    const callback=()=>{controller.abort();if(throws)throw Error("guest failure");return {replacement:new CodePointString(new Uint32Array()),position:2,input:new Uint8Array()};};
    expect(()=>operation==="encode"?encodeWideUnicode(new CodePointString(new Uint32Array([0xd800])),16,-1,callback,meter):decodeWideUnicode(new Uint8Array([0,0xdc]),16,-1,callback,meter)).toThrow(ExecutionLimitError);
  }
});

it("matches pinned CPython UTF-16/32 encoders including each surrogate policy and BOM",()=>{
  for(const sample of reference.encode){
    const input=new CodePointString(new Uint32Array(sample.input));
    let actual:unknown;
    try {actual={result:[...encodeWideUnicode(input,sample.width as 16|32,sample.order as -1|0|1,sample.errors as Utf8EncodeErrors)]};}
    catch(error){
      if(!(error instanceof PythonEncodeError))throw error;
      actual={error:[error.encoding,error.start,error.end,error.reason]};
    }
    expect(actual,JSON.stringify(sample)).toEqual(sample.result===undefined?{error:sample.error}:{result:sample.result});
  }
});
