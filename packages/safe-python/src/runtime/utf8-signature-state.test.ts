import {expect,it} from "vitest";
import reference from "./__snapshots__/utf8-signature-state-3.14.7.json";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonEncodeError} from "./encode-error.js";
import type {Utf8DecodeErrors} from "./utf8-decode.js";
import type {Utf8EncodeErrors} from "./utf8-encode.js";
import {Utf8SignatureDecoder,Utf8SignatureEncoder} from "./utf8-signature.js";

function outcome(call:()=>CodePointString|Uint8Array){
  try {return {value:[...call()]};}
  catch(error){
    if(!(error instanceof PythonDecodeError)&&!(error instanceof PythonEncodeError))throw error;
    return {error:{name:error.name,encoding:error.encoding,object:[...error.object],start:error.start,end:error.end,reason:error.reason}};
  }
}

it.each(reference.decodes)("CPython signature decoder $policy bytes $input split $split",row=>{
  const decoder=new Utf8SignatureDecoder(row.policy as Utf8DecodeErrors);
  const state=()=>{const [buffer,first]=decoder.getstate();return [[...buffer],Number(first)];};
  for(const call of row.calls){
    expect(outcome(()=>decoder.decode(new Uint8Array(call.input),call.final))).toEqual(call.result);
    expect(state()).toEqual(call.state);
  }
  const saved=decoder.getstate();
  decoder.reset();expect(state()).toEqual(row.reset);
  decoder.setstate(saved);expect(state()).toEqual(row.restored);
});

it.each(reference.encodes)("CPython signature encoder $policy points $input split $split",row=>{
  const encoder=new Utf8SignatureEncoder(row.policy as Utf8EncodeErrors);
  for(const call of row.calls){
    expect(outcome(()=>encoder.encode(new CodePointString(new Uint32Array(call.input)),call.final))).toEqual(call.result);
    expect(Number(encoder.getstate())).toBe(call.state);
  }
  encoder.reset();expect(Number(encoder.getstate())).toBe(row.reset);
  encoder.setstate(-7n);
  expect(outcome(()=>encoder.encode(new CodePointString(new Uint32Array([65])),true))).toEqual(row.restoredCall);
  expect(Number(encoder.getstate())).toBe(row.restoredState);
});
