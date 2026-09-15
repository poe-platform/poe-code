import {CodePointString} from "./code-point-string.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {decodeUtf8,type Utf8Decoded,type Utf8DecodeErrors,type Utf8DecodeRecovery} from "./utf8-decode.js";
import {encodeUtf8,type Utf8EncodeErrors,type Utf8EncodeRecovery} from "./utf8-encode.js";
import type {Utf8DecoderState} from "./utf8-incremental.js";

// Immutable protocol bytes; never expose a mutable shared Uint8Array to callers.
const signature=Object.freeze([0xef,0xbb,0xbf]);

export function encodeUtf8Signature(input:CodePointString,errors:Utf8EncodeErrors|Utf8EncodeRecovery="strict",meter?:ExecutionMeter,recover?:Utf8EncodeRecovery):Uint8Array {
  const encoded=encodeUtf8(input,errors,meter,recover),length=signature.length+encoded.length;
  meter?.checkpoint(length,64+length);
  const output=new Uint8Array(length);
  output.set(signature);output.set(encoded,signature.length);
  return output;
}

export function decodeUtf8Signature(input:Uint8Array,errors:Utf8DecodeErrors|Utf8DecodeRecovery="strict",meter?:ExecutionMeter):Utf8Decoded {
  meter?.checkpoint();
  const prefix=input.length>=3&&signature.every((byte,index)=>input[index]===byte)?3:0;
  meter?.checkpoint(0,64);
  const result=decodeUtf8(input.subarray(prefix),errors,meter,true);
  meter?.checkpoint(0,48);
  return {text:result.text,consumed:result.consumed+prefix};
}

/** Internal state kernel for encodings.utf_8_sig. Guest attribute/type protocols
 * belong to the codec classes; the integer state here is not a guest validator. */
export class Utf8SignatureEncoder {
  #first=1n;
  constructor(public errors:Utf8EncodeErrors|Utf8EncodeRecovery="strict") {}

  encode(input:CodePointString,_final=false,meter?:ExecutionMeter):Uint8Array {
    meter?.checkpoint();
    if(this.#first!==0n){
      // CPython consumes first even if the subsequent UTF-8 encode raises.
      this.#first=0n;
      return encodeUtf8Signature(input,this.errors,meter);
    }
    return encodeUtf8(input,this.errors,meter);
  }

  getstate(meter?:ExecutionMeter):bigint {meter?.checkpoint();return this.#first;}
  setstate(state:bigint,meter?:ExecutionMeter):void {meter?.checkpoint();this.#first=state;}
  reset(meter?:ExecutionMeter):void {meter?.checkpoint();this.#first=1n;}
}

/** BOM recognition is distinct from buffered-byte commitment: a Unicode error
 * can consume first while leaving the old buffer intact. A partial BOM remains
 * undecided even on a final call, as in the pinned standard-library codec. */
export class Utf8SignatureDecoder {
  #pending=new Uint8Array();
  #first=1n;
  constructor(public errors:Utf8DecodeErrors|Utf8DecodeRecovery="strict") {}

  decode(input:Uint8Array,final=false,meter?:ExecutionMeter):CodePointString {
    meter?.checkpoint();
    let combined=input;
    if(this.#pending.length!==0){
      const length=this.#pending.length+input.length;
      // Admit the complete merge before BOM detection can consume first.
      meter?.checkpoint(length,64+length);
      combined=new Uint8Array(length);
      combined.set(this.#pending);combined.set(input,this.#pending.length);
    }
    let prefix=0,result:Utf8Decoded;
    const ambiguous=this.#first!==0n&&combined.length<3&&combined.every((byte,index)=>signature[index]===byte);
    if(ambiguous){
      // The empty result still owns a record, string wrapper and both the
      // temporary and copied typed arrays. Admit them before buffering input.
      meter?.checkpoint(1,192);
      result={text:new CodePointString(new Uint32Array(),meter),consumed:0};
    }else{
      if(this.#first!==0n){
        this.#first=0n;
        if(combined.length>=3&&signature.every((byte,index)=>combined[index]===byte))prefix=3;
      }
      meter?.checkpoint(0,64);
      result=decodeUtf8(combined.subarray(prefix),this.errors,meter,final);
    }
    const consumed=result.consumed+prefix,remaining=Math.max(0,combined.length-consumed);
    meter?.checkpoint(remaining+1,64+remaining);
    this.#pending=combined.slice(consumed);
    return result.text;
  }

  getstate(meter?:ExecutionMeter):Utf8DecoderState {
    meter?.checkpoint(this.#pending.length+1,96+this.#pending.byteLength);
    return [this.#pending.slice(),this.#first];
  }

  setstate(state:Utf8DecoderState,meter?:ExecutionMeter):void {
    meter?.checkpoint(state[0].length+1,64+state[0].byteLength);
    this.#pending=new Uint8Array(state[0]);this.#first=state[1];
  }

  reset(meter?:ExecutionMeter):void {
    meter?.checkpoint(1,64);this.#pending=new Uint8Array();this.#first=1n;
  }
}
