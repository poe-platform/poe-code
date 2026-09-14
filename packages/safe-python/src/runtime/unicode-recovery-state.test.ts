import {expect,it} from "vitest";
import reference from "./__snapshots__/unicode-recovery-state-3.14.7.json";
import {CodePointString} from "./code-point-string.js";
import {decodeUnicodeEscape,UnicodeEscapeDecoder} from "./unicode-escape.js";
import {decodeUtf7,Utf7Decoder} from "./utf7.js";
import {decodeUtf8,type Utf8DecodeRecovery} from "./utf8-decode.js";
import {Utf8IncrementalDecoder} from "./utf8-incremental.js";
import {decodeUtf8Signature,Utf8SignatureDecoder} from "./utf8-signature.js";
import {decodeWideUnicode} from "./utf-wide.js";
import {WideUnicodeDecoder} from "./utf-wide-incremental.js";

function fixture(name:string,replacement:number[]){
  const events:unknown[][]=[];
  const recover:Utf8DecodeRecovery=error=>{
    events.push([error.encoding,[...error.object],error.start,error.end,error.reason]);
    return events.length===1
      ?{replacement:new CodePointString(new Uint32Array([63])),position:0,input:new Uint8Array(replacement)}
      :{replacement:new CodePointString(new Uint32Array([33])),position:error.object.length,input:error.object};
  };
  const warn=()=>{throw Error("unexpected warning");};
  const width=name.startsWith("utf_16")?16:32,order=name.endsWith("_be")?1:name.endsWith("_le")?-1:0;
  const decoder=name==="utf_7"?new Utf7Decoder(recover):name==="utf_8"?new Utf8IncrementalDecoder(recover):name==="utf_8_sig"?new Utf8SignatureDecoder(recover):name.includes("escape")?new UnicodeEscapeDecoder(name==="raw_unicode_escape",recover,warn):new WideUnicodeDecoder(width,order,recover);
  const decode=(input:Uint8Array,final:boolean)=>name==="utf_7"?decodeUtf7(input,recover,undefined,final):name==="utf_8"?decodeUtf8(input,recover,undefined,final):name==="utf_8_sig"?decodeUtf8Signature(input,recover):name.includes("escape")?decodeUnicodeEscape(input,name==="raw_unicode_escape",recover,undefined,final,warn):decodeWideUnicode(input,width,order,recover,undefined,final);
  return {events,decoder,decode};
}

it("matches pinned consumed counts after error.object replacement",()=>{
  expect(reference.oracle.unicode).toBe("16.0.0");
  expect(reference.oracle.byteorder).toBe("little");
  for(const row of reference.decode){
    const {events,decode}=fixture(row.name,row.replacement);
    const result=decode(new Uint8Array(row.input),row.final);
    expect({result:[[...result.text],result.consumed],events},JSON.stringify(row)).toEqual(row.call);
  }
});

it("matches replacement recovery and buffered state at every input split",()=>{
  for(const row of reference.incremental){
    const {events,decoder}=fixture(row.name,row.replacement),input=new Uint8Array(row.input);
    for(const [index,chunk] of [input.slice(0,row.split),input.slice(row.split)].entries()){
      const before=events.length,result=decoder.decode(chunk,index===1&&row.final),state=decoder.getstate();
      expect({result:[...result],events:events.slice(before),state:[[...state[0]],Number(state[1])]},JSON.stringify({row,index})).toEqual(row.calls[index]);
    }
  }
});
