import {describe,expect,it} from "vitest";
import baseEvidence from "./__snapshots__/iso2022-jp-recovery-oracle.json";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import type {PythonDecodeError} from "./decode-error.js";
import type {PythonEncodeError} from "./encode-error.js";
import {DoubleByteIncrementalDecoder} from "./double-byte-incremental-decoder.js";
import {DoubleByteIncrementalEncoder} from "./double-byte-incremental-encoder.js";
import {iso2022JpCodec as baseCodec} from "./iso2022-jp-codec.js";
import variantEvidence from "./__snapshots__/iso2022-jp-1-recovery-oracle.json";
import {iso2022Jp1Codec} from "./iso2022-jp-1-codec.js";

import extEvidence from "./__snapshots__/iso2022-jp-ext-recovery-oracle.json";
import {iso2022JpExtCodec} from "./iso2022-jp-ext-codec.js";

import jp2Evidence from "./__snapshots__/iso2022-jp-2-recovery-oracle.json";
import {iso2022Jp2Codec} from "./iso2022-jp-2-codec.js";

describe.each([
  {codec:iso2022Jp2Codec,evidence:jp2Evidence,encodeInput:"가😀い",decodeInput:[27,36,40,67,255,36,34]},
  {codec:iso2022JpExtCodec,evidence:extEvidence,encodeInput:"ｱ😀い",decodeInput:[27,40,73,255,49,33]},
  {codec:baseCodec,evidence:baseEvidence,encodeInput:"あ😀い",decodeInput:[27,36,66,255,36,34]},
  {codec:iso2022Jp1Codec,evidence:variantEvidence,encodeInput:"丂😀い",decodeInput:[27,36,40,68,255,48,33]}
])("$codec.name",({codec:iso2022JpCodec,evidence,encodeInput,decodeInput})=>{

const meter=()=>new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
const text=(input:string)=>CodePointString.fromString(input,meter());
const input=Uint8Array.from(decodeInput);

it("rejects an oversized serialized kana state before changing the encoder",()=>{
  const budget=meter(),encoder=new DoubleByteIncrementalEncoder(iso2022JpCodec);
  const initial=encoder.getstate(budget);
  // External CPython 3.14.7 oracle: a nine-byte UTF-8 pending prefix followed
  // by eight native bytes exceeds the unsigned 136-bit serialized boundary.
  let state=0x4242424242424242n;
  for(const byte of [0x9f,0xbe,0xef,0xb1,0xbd,0xef,0xa1,0xbd,0xef])state=(state<<8n)|BigInt(byte);
  state=(state<<8n)|9n;
  expect(()=>encoder.setstate(state,budget)).toThrow(expect.objectContaining({name:"OverflowError",message:"int too big to convert"}));
  expect(encoder.getstate(budget)).toBe(initial);
});

it.each(evidence.rows.map((row,index)=>({...row,index})))("matches recovery return, negative position and failure state $index",row=>{
  const budget=meter(),events:unknown[]=[];
  const recover=(error:PythonDecodeError|PythonEncodeError)=>{
    events.push([row.kind==="encode"?"UnicodeEncodeError":"UnicodeDecodeError",[...error.object],Number(error.start),Number(error.end),error.reason]);
    if(events.length>1)throw new PythonRuntimeError("ValueError","repeat");
    return {replacement:new CodePointString(Uint32Array.from(row.replacement),budget),position:BigInt(row.position)};
  };
  const encoder=new DoubleByteIncrementalEncoder(iso2022JpCodec,error=>{
    const result=recover(error);
    return {...result,replacement:row.raw?Uint8Array.from(row.replacement):result.replacement};
  }),decoder=new DoubleByteIncrementalDecoder(iso2022JpCodec,recover);
  let result:unknown;
  try{result=["ok",[...(row.kind==="encode"?encoder.encode(text(encodeInput),true,budget):decoder.decode(input,true,budget))]];}
  catch(error){if(!(error instanceof PythonRuntimeError))throw error;result=["error",error.name,error.message];}
  const [pending,state]=decoder.getstate(budget);
  expect({events,result,state:row.kind==="encode"?String(encoder.getstate(budget)):[[...pending],String(state)]}).toEqual({events:row.events,result:row.result,state:row.state});
});

it.each([false,true])("keeps cancellation terminal after recovery return or throw (%s)",throws=>{
  for(const operation of ["encode","decode"] as const){
    const controller=new AbortController(),budget=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000,signal:controller.signal});
    const recover=()=>{controller.abort();if(throws)throw new PythonRuntimeError("ValueError","guest failed");return {replacement:text("?"),position:-1n};};
    expect(()=>operation==="encode"?iso2022JpCodec.encode(text(encodeInput),recover,budget):iso2022JpCodec.decode(input,recover,budget)).toThrow(expect.objectContaining({reason:"cancelled"}));
    expect(()=>iso2022JpCodec.encode(text(""),"strict",budget)).toThrow(ExecutionLimitError);
  }
});

it("restores pending escape and designation state at every split",()=>{
  const budget=meter(),source=text(evidence.splitSource),encoded=iso2022JpCodec.encode(source,"strict",budget);
  expect([...encoded]).toEqual(evidence.splitEncoded);
  for(let split=0;split<=encoded.length;split++){
    const first=new DoubleByteIncrementalDecoder(iso2022JpCodec),restored=new DoubleByteIncrementalDecoder(iso2022JpCodec);
    const prefix=first.decode(encoded.slice(0,split),false,budget);
    restored.setstate(first.getstate(budget),budget);
    expect([...prefix,...restored.decode(encoded.slice(split),true,budget)]).toEqual([...source]);
  }
  for(let split=0;split<=source.length;split++){
    const first=new DoubleByteIncrementalEncoder(iso2022JpCodec),restored=new DoubleByteIncrementalEncoder(iso2022JpCodec);
    const prefix=first.encode(source.slice(0n,BigInt(split),null,budget),false,budget);
    restored.setstate(first.getstate(budget),budget);
    expect([...prefix,...restored.encode(source.slice(BigInt(split),null,null,budget),true,budget)]).toEqual([...encoded]);
  }
});

// CPython 3.14.7 oracle: callbacks share the active native designation state;
// resetting or reentering changes the outer operation before replacement text.
it.each(evidence.reentrant)("retains shared encoder and decoder state after callback $action",row=>{
  const {action}=row;
  const budget=meter(),nested:unknown[]=[];
  const encoder=new DoubleByteIncrementalEncoder(iso2022JpCodec,()=>{
    if(action==="reset")encoder.reset(budget);
    else nested.push([...encoder.encode(text("A"),false,budget)]);
    return {replacement:text("?"),position:-1n};
  });
  expect([...encoder.encode(text(encodeInput),true,budget)]).toEqual(row.encoded);
  expect(String(encoder.getstate(budget))).toBe(row.encoderState);
  const decoder=new DoubleByteIncrementalDecoder(iso2022JpCodec,()=>{
    if(action==="reset")decoder.reset(budget);
    else nested.push([...decoder.decode(Uint8Array.of(27,40,66,65),false,budget)]);
    return {replacement:text("?"),position:-2n};
  });
  expect([...decoder.decode(input,true,budget)]).toEqual(row.decoded);
  const [pending,flags]=decoder.getstate(budget);
  expect([[...pending],String(flags)]).toEqual(row.decoderState);
  expect(nested).toEqual(row.nested);
});

});
