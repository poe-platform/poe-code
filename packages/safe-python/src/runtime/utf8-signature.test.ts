import {expect,it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget,ExecutionLimitError} from "./execution-budget.js";
import {decodeUtf8Signature,encodeUtf8Signature,Utf8SignatureDecoder,Utf8SignatureEncoder} from "./utf8-signature.js";

const bytes=(...input:number[])=>new Uint8Array(input);
const text=(...points:number[])=>new CodePointString(new Uint32Array(points));

it("emits a signature on every stateless encode, including empty input",()=>{
  expect(encodeUtf8Signature(text())).toEqual(bytes(239,187,191));
  expect(encodeUtf8Signature(text(0xfeff,0x1f40d))).toEqual(bytes(239,187,191,239,187,191,240,159,144,141));
});

it("strips exactly one leading signature and includes it in the consumed count",()=>{
  const result=decodeUtf8Signature(bytes(239,187,191,239,187,191,65));
  expect([...result.text]).toEqual([0xfeff,65]);expect(result.consumed).toBe(7);
  expect([...decodeUtf8Signature(bytes(65,239,187,191)).text]).toEqual([65,0xfeff]);
  expect(()=>decodeUtf8Signature(bytes(239,187,191,255))).toThrow(expect.objectContaining({encoding:"utf-8",object:bytes(255),start:0,end:1,reason:"invalid start byte"}));
});

it.each([[],[239],[239,187]].map(input=>({input})))("retains ambiguous signature prefix $input even on final input",({input})=>{
  const decoder=new Utf8SignatureDecoder();
  expect([...decoder.decode(new Uint8Array(input),true)]).toEqual([]);
  expect(decoder.getstate()).toEqual([new Uint8Array(input),1n]);
  if(input.length)expect(()=>decodeUtf8Signature(new Uint8Array(input))).toThrow(expect.objectContaining({reason:"unexpected end of data"}));
});

it.each(["strict","ignore","replace","surrogatepass","surrogateescape","backslashreplace"] as const)("decodes every byte split without losing BOM or multibyte state (%s)",errors=>{
  const input=bytes(239,187,191,65,226,130,172,240,159,144,141,239,187,191);
  for(let split=0;split<=input.length;split++){
    const decoder=new Utf8SignatureDecoder(errors);
    expect([...decoder.decode(input.slice(0,split)),...decoder.decode(input.slice(split),true)]).toEqual([65,0x20ac,0x1f40d,0xfeff]);
    expect(decoder.getstate()).toEqual([bytes(),0n]);
  }
});

it("commits BOM detection before decode failure but retains the previous buffer",()=>{
  const decoder=new Utf8SignatureDecoder();decoder.decode(bytes(239));
  expect(()=>decoder.decode(bytes(187,191,255))).toThrow(expect.objectContaining({object:bytes(255),start:0,end:1}));
  expect(decoder.getstate()).toEqual([bytes(239),0n]);
  expect([...decoder.decode(bytes(187,191))]).toEqual([0xfeff]);
  decoder.reset();expect(decoder.getstate()).toEqual([bytes(),1n]);
});

it("roundtrips owned buffers and integer state without normalizing its value",()=>{
  const decoder=new Utf8SignatureDecoder(),pending=bytes(239);
  decoder.setstate([pending,-9n]);pending[0]=65;
  const state=decoder.getstate();state[0][0]=66;
  expect(decoder.getstate()).toEqual([bytes(239),-9n]);
  expect([...decoder.decode(bytes(),true)]).toEqual([]);
  expect(decoder.getstate()[1]).toBe(-9n);
  expect([...decoder.decode(bytes(187,191,65))]).toEqual([65]);
});

it("emits once per encoder reset and consumes first state before a Unicode error",()=>{
  const encoder=new Utf8SignatureEncoder();
  expect(encoder.getstate()).toBe(1n);
  expect(encoder.encode(text())).toEqual(bytes(239,187,191));
  expect(encoder.encode(text(65),true)).toEqual(bytes(65));
  encoder.reset();
  expect(()=>encoder.encode(text(0xd800))).toThrow(expect.objectContaining({encoding:"utf-8",start:0,end:1}));
  expect(encoder.getstate()).toBe(0n);expect(encoder.encode(text(65))).toEqual(bytes(65));
  encoder.setstate(-7n);expect(encoder.getstate()).toBe(-7n);
  expect(encoder.encode(text(66))).toEqual(bytes(239,187,191,66));
});

it.each(["surrogatepass","surrogateescape"] as const)("preserves split surrogate policy %s",errors=>{
  const point=errors==="surrogatepass"?0xd800:0xdcff;
  const encoded=encodeUtf8Signature(text(point),errors),decoder=new Utf8SignatureDecoder(errors);
  const output:number[]=[];
  for(const byte of encoded)output.push(...decoder.decode(bytes(byte)));
  output.push(...decoder.decode(bytes(),true));expect(output).toEqual([point]);
});

it("checks cancellation before mutating either state",()=>{
  const controller=new AbortController();controller.abort();
  const meter=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:10000,signal:controller.signal});
  const decoder=new Utf8SignatureDecoder(),encoder=new Utf8SignatureEncoder();
  expect(()=>decoder.decode(bytes(239,187,191),true,meter)).toThrow(ExecutionLimitError);
  expect(()=>encoder.encode(text(65),true,meter)).toThrow(ExecutionLimitError);
  expect(decoder.getstate()).toEqual([bytes(),1n]);expect(encoder.getstate()).toBe(1n);
});

it("does not replace buffered state when combined-input allocation is denied",()=>{
  const decoder=new Utf8SignatureDecoder();decoder.decode(bytes(239));
  const meter=new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:2});
  expect(()=>decoder.decode(bytes(187,191),false,meter)).toThrow(expect.objectContaining({reason:"allocation"}));
  expect(decoder.getstate()).toEqual([bytes(239),1n]);
});

it("allows an error policy change to recover buffered multibyte input after the BOM",()=>{
  const decoder=new Utf8SignatureDecoder();decoder.decode(bytes(239,187,191,226,130));
  expect(()=>decoder.decode(bytes(),true)).toThrow(expect.objectContaining({object:bytes(226,130),start:0,end:2,reason:"unexpected end of data"}));
  expect(decoder.getstate()).toEqual([bytes(226,130),0n]);
  decoder.errors="surrogateescape";
  expect([...decoder.decode(bytes(),true)]).toEqual([0xdce2,0xdc82]);
  expect(decoder.getstate()).toEqual([bytes(),0n]);
});
