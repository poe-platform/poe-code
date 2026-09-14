import {expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {PythonEncodeError} from "./encode-error.js";
import {encodeUtf8Signature,Utf8SignatureEncoder} from "./utf8-signature.js";

const text=(...points:number[])=>new CodePointString(new Uint32Array(points));

it("recovers grouped surrogates through the signature encoder after consuming first",()=>{
  const events:unknown[]=[];
  const encoder=new Utf8SignatureEncoder(error=>{
    events.push([error.encoding,[...error.object],error.start,error.end,error.reason,encoder.getstate()]);
    return {replacement:new Uint8Array([255]),position:error.end};
  });
  expect([...encoder.encode(text(65,0xd800,0xdfff,66,0xdc80))]).toEqual([239,187,191,65,255,66,255]);
  expect(events).toEqual([
    ["utf-8",[65,0xd800,0xdfff,66,0xdc80],1,3,"surrogates not allowed",0n],
    ["utf-8",[65,0xd800,0xdfff,66,0xdc80],4,5,"surrogates not allowed",0n],
  ]);
  expect(encoder.getstate()).toBe(0n);
});

it("grows for arbitrary bytes and ASCII replacement strings without repeating the BOM",()=>{
  const input=text(65,0xd800,66);
  for(const replacement of [new Uint8Array(80).fill(255),text(...new Array<number>(80).fill(90))]){
    const expected=replacement instanceof Uint8Array?[...replacement]:new Array<number>(80).fill(90);
    expect([...encodeUtf8Signature(input,error=>({replacement,position:error.end}))]).toEqual([239,187,191,65,...expected,66]);
  }
});

it.each([0x80,0x20ac,0x1f40d,0xd800])("rejects non-ASCII text replacement U+%s with the original fault",point=>{
  let fault:PythonEncodeError|undefined;
  const encoder=new Utf8SignatureEncoder(error=>{
    fault=error;
    return {replacement:text(point),position:error.end};
  });
  try {encoder.encode(text(65,0xd800,0xdfff));throw new Error("expected encoding failure");}
  catch(error){expect(error).toBe(fault);}
  expect(encoder.getstate()).toBe(0n);
});

it("preserves registry-prepared exception identity for invalid replacement strings",()=>{
  const failure=new Error("guest exception identity");
  expect(()=>encodeUtf8Signature(text(0xd800),error=>({replacement:text(0x80),position:error.end,failure}))).toThrow(failure);
});

it("retains encoder reset performed by a recovery callback",()=>{
  const encoder=new Utf8SignatureEncoder(error=>{
    encoder.reset();
    return {replacement:text(63),position:error.end};
  });
  expect([...encoder.encode(text(0xd800))]).toEqual([239,187,191,63]);
  expect(encoder.getstate()).toBe(1n);
  expect([...encoder.encode(text(65))]).toEqual([239,187,191,65]);
});

it("permits validated backward recovery positions and meters non-progress",()=>{
  let calls=0;
  expect([...encodeUtf8Signature(text(65,0xd800),error=>({replacement:text(63),position:++calls===1?0:error.end}))]).toEqual([239,187,191,65,63,65,63]);
  const meter=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:100000});
  expect(()=>encodeUtf8Signature(text(0xd800),()=>({replacement:text(),position:0}),meter)).toThrow(ExecutionLimitError);
});

it("checks cancellation immediately after recovery and leaves first consumed",()=>{
  const controller=new AbortController();
  const meter=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:100000,signal:controller.signal});
  const encoder=new Utf8SignatureEncoder(error=>{
    controller.abort();
    return {replacement:text(63),position:error.end};
  });
  expect(()=>encoder.encode(text(0xd800),false,meter)).toThrow(ExecutionLimitError);
  expect(encoder.getstate()).toBe(0n);
});
