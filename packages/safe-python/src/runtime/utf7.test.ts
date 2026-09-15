import {expect,it} from "vitest";
import reference from "./__snapshots__/utf7-3.14.7.json";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {decodeUtf7,encodeUtf7,Utf7Decoder} from "./utf7.js";

it.each([1,7])("retains original UTF-7 EOF error bounds after input replacement (original length %i)",length=>{
  // CPython 3.14.7 retains the original size even when it is smaller than
  // error.start or larger than the replacement error.object. Do not clamp it.
  const original=new Uint8Array(length).fill(65);original[0]=255;
  for(const [replacement,prefix] of [["+A",""],["AB+A","AB"],["+2AA",""],["ABC+A","ABC"]]){
    const input=Uint8Array.from(replacement,character=>character.charCodeAt(0));
    const events:unknown[]=[];
    const result=decodeUtf7(original,error=>{
      events.push([[...error.object],error.start,error.end,error.reason]);
      return {replacement:new CodePointString(new Uint32Array(events.length===1?[]:[63])),position:events.length===1?0:input.length,input};
    });
    expect(events).toEqual([
      [[...original],0,1,"unexpected special character"],
      [[...input],prefix.length,length,"unterminated shift sequence"]
    ]);
    expect([...result.text]).toEqual([...prefix].map(character=>character.charCodeAt(0)).concat(63));
    expect(result.consumed).toBe(length);
  }
});

it("matches pinned UTF-7 decode values, consumed counts and exact failures",()=>{
  expect(reference.oracle.unicode).toBe("16.0.0");
  for(const sample of reference.decode){
    let actual:unknown;
    try {const result=decodeUtf7(new Uint8Array(sample.input),sample.errors as Exclude<Parameters<typeof decodeUtf7>[1],undefined>,undefined,sample.final);actual={result:[[...result.text],result.consumed]};}
    catch(error){
      if(error instanceof PythonDecodeError)actual={error:[error.encoding,[...error.object],error.start,error.end,error.reason]};
      else if(error instanceof PythonRuntimeError)actual={failure:[error.name,error.message]};
      else throw error;
    }
    const expected=sample.result!==undefined?{result:sample.result}:sample.error!==undefined?{error:sample.error}:{failure:sample.failure};
    expect(actual,JSON.stringify(sample)).toEqual(expected);
  }
});

it("matches pinned UTF-7 encoding including direct sets, plus escaping and lone surrogates",()=>{
  for(const sample of reference.encode){
    expect([...encodeUtf7(new CodePointString(new Uint32Array(sample.input)))],JSON.stringify(sample.input)).toEqual(sample.result);
  }
});

it("buffers complete shift runs until termination at every split and restores decoder state",()=>{
  const source=new CodePointString(new Uint32Array([65,0x20ac,0x1f40d,0xd800,66,43,0xdc00]));
  const encoded=encodeUtf7(source);
  for(let split=0;split<=encoded.length;split++){
    const decoder=new Utf7Decoder(),first=decoder.decode(encoded.slice(0,split));
    const state=decoder.getstate(),copy=new Utf7Decoder();copy.setstate(state);
    expect([...first,...decoder.decode(encoded.slice(split),true)]).toEqual([...source]);
    expect([...copy.decode(encoded.slice(split),true)]).toEqual([...source].slice(first.length));
    decoder.reset();expect(decoder.getstate()).toEqual([new Uint8Array(),0n]);
  }
});

it("resumes in replacement input, preserves emitted text before faults and grows callback output",()=>{
  const replacement=new CodePointString(new Uint32Array(80).fill(63));
  const result=decodeUtf7(new Uint8Array([43,65,66,67,45]),error=>{
    expect(error).toMatchObject({encoding:"utf7",start:0,end:5,reason:"non-zero padding bits in shift sequence"});
    return {replacement,position:1,input:new Uint8Array([0,90])};
  });
  expect([...result.text]).toEqual([16,...replacement,90]);expect(result.consumed).toBe(5);
});

it("does not commit buffered state after errors and copies supplied state",()=>{
  const decoder=new Utf7Decoder();decoder.decode(new Uint8Array([43,65]));
  expect(()=>decoder.decode(new Uint8Array([45]),true)).toThrow(PythonDecodeError);
  expect(decoder.getstate()).toEqual([new Uint8Array([43,65]),0n]);
  const buffer=new Uint8Array([43,65,65,65]);decoder.setstate([buffer,99n]);buffer[0]=0;
  const state=decoder.getstate();state[0][0]=0;
  expect([...decoder.decode(new Uint8Array([45]),true)]).toEqual([0]);
});

it.each([false,true])("cancellation dominates recovery return and failure (throws=%s)",throws=>{
  const controller=new AbortController(),meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:100000,signal:controller.signal});
  expect(()=>decodeUtf7(new Uint8Array([255]),()=>{
    controller.abort();if(throws)throw Error("guest failure");
    return {replacement:new CodePointString(new Uint32Array()),position:1,input:new Uint8Array([255])};
  },meter)).toThrow(ExecutionLimitError);
});

it("meters non-advancing recovery and encoder input",()=>{
  const meter=new ExecutionBudget({maxSteps:100,maxAllocatedBytes:100000});
  expect(()=>decodeUtf7(new Uint8Array([255]),()=>({replacement:new CodePointString(new Uint32Array()),position:0,input:new Uint8Array([255])}),meter)).toThrow(ExecutionLimitError);
  const controller=new AbortController();controller.abort();
  expect(()=>encodeUtf7(new CodePointString(new Uint32Array([65])),new ExecutionBudget({maxSteps:100,maxAllocatedBytes:100000,signal:controller.signal}))).toThrow(ExecutionLimitError);
});
