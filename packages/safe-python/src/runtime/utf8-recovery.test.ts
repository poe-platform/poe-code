import {expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {decodeUtf8} from "./utf8-decode.js";
import {Utf8IncrementalDecoder} from "./utf8-incremental.js";
import {decodeUtf8Signature,Utf8SignatureDecoder} from "./utf8-signature.js";

const replacement=new CodePointString(new Uint32Array(20).fill(63));

it("recovers UTF-8 into replacement input and returns its consumed position",()=>{
  const seen:PythonDecodeError[]=[];
  const result=decodeUtf8(new Uint8Array([65,255]),error=>{
    seen.push(error);
    return {replacement,position:1,input:new Uint8Array([0,90,0xe2])};
  },undefined,false);
  expect([...result.text]).toEqual([65,...replacement,90]);
  expect(result.consumed).toBe(2);
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({encoding:"utf-8",start:1,end:2,reason:"invalid start byte",object:new Uint8Array([65,255])});
});

it("reports BOM-relative errors and consumes the original input on final decoding",()=>{
  const result=decodeUtf8Signature(new Uint8Array([239,187,191,255]),error=>{
    expect(error).toMatchObject({start:0,end:1,object:new Uint8Array([255])});
    return {replacement,position:1,input:new Uint8Array([0,90])};
  });
  expect([...result.text]).toEqual([...replacement,90]);
  expect(result.consumed).toBe(4);
});

it.each([false,true])("buffers the original input after callback replacement (BOM=%s)",bom=>{
  const decoder=bom?new Utf8SignatureDecoder():new Utf8IncrementalDecoder();
  decoder.errors=()=>({replacement,position:1,input:new Uint8Array([0,90,0xe2])});
  expect([...decoder.decode(new Uint8Array(bom?[239,187,191,255]:[255]))]).toEqual([...replacement,90]);
  expect(decoder.getstate()).toEqual([new Uint8Array(),0n]);
  expect([...decoder.decode(new Uint8Array([65]),true)]).toEqual([65]);
});

it.each([false,true])("keeps buffered state when recovery throws (BOM=%s)",bom=>{
  const decoder=bom?new Utf8SignatureDecoder():new Utf8IncrementalDecoder();
  decoder.decode(new Uint8Array(bom?[239,187,191,0xe2]:[0xe2]));
  const failure=new Error("guest failure");
  decoder.errors=()=>{throw failure;};
  expect(()=>decoder.decode(new Uint8Array([65]),true)).toThrow(failure);
  expect(decoder.getstate()).toEqual([new Uint8Array([0xe2]),0n]);
});

it.each([false,true])("calls recovery for surrogate bytes across every split (BOM=%s)",bom=>{
  const source=new Uint8Array([...(bom?[239,187,191]:[]),65,0xe2,0x82,0xac,0xed,0xa0,0x80,90]);
  for(let split=0;split<=source.length;split++){
    const decoder=bom?new Utf8SignatureDecoder():new Utf8IncrementalDecoder();
    let calls=0;
    decoder.errors=error=>{
      calls++;
      expect(error.end-error.start).toBe(1);
      return {replacement:new CodePointString(new Uint32Array([63])),position:error.end,input:error.object};
    };
    expect([...decoder.decode(source.slice(0,split)),...decoder.decode(source.slice(split),true)]).toEqual([65,0x20ac,63,63,63,90]);
    expect(calls).toBe(3);
    expect(decoder.getstate()).toEqual([new Uint8Array(),0n]);
  }
});

it.each([false,true])("cancellation dominates UTF-8 recovery return and failure (throws=%s)",throws=>{
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:100000,signal:controller.signal});
  expect(()=>decodeUtf8(new Uint8Array([255]),()=>{
    controller.abort();if(throws)throw Error("guest failure");
    return {replacement,position:1,input:new Uint8Array([255])};
  },meter)).toThrow(ExecutionLimitError);
});

it("meters non-advancing callbacks and does not call recovery on valid or incomplete input",()=>{
  const meter=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:100000});
  expect(()=>decodeUtf8(new Uint8Array([255]),()=>({replacement,position:0,input:new Uint8Array([255])}),meter)).toThrow(ExecutionLimitError);
  const unexpected=()=>{throw Error("unexpected recovery");};
  expect([...decodeUtf8(new Uint8Array([65]),unexpected).text]).toEqual([65]);
  expect(decodeUtf8(new Uint8Array([0xe2]),unexpected,undefined,false).consumed).toBe(0);
});
