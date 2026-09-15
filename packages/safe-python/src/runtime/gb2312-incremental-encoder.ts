import type {ImmutableBytes} from "./immutable-bytes.js";
import type {CodePointString} from "./code-point-string.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {encodeGb2312,type MultibyteEncodeRecovery,type MultibyteErrors} from "./gb2312-codec.js";
import {decodeUtf8,type Utf8DecodeRecovery} from "./utf8-decode.js";
import {encodeUtf8} from "./utf8-encode.js";

/** Native multibyte encoder state after guest str/int argument conversion.
 * GB2312 has no shift or final-flush bytes, but setstate can install pending
 * UTF-8 text and eight opaque codec-state bytes in a little-endian integer. */
export class Gb2312IncrementalEncoder {
  #pending:CodePointString|undefined;
  #state=0n;

  constructor(public errors:MultibyteErrors|MultibyteEncodeRecovery="strict") {}

  encode(input:CodePointString,meter:ExecutionMeter):Uint8Array {
    meter.checkpoint();
    const original=this.#pending;
    const combined=original===undefined||original.length===0?input:original.concat(input,meter);
    this.#pending=undefined;
    try{return encodeGb2312(combined,this.errors,meter);}
    catch(error){this.#pending=original;throw error;}
  }

  getstate(meter:ExecutionMeter,serialize?:(text:CodePointString)=>ImmutableBytes):bigint {
    // The state integer and packing temporaries allocate independently of
    // pending UTF-8 storage, including its empty typed-array representation.
    meter.checkpoint(1,128+(this.#pending===undefined?64:0));
    // The owning binding retains the guest string identity and resolves its
    // cached strict UTF-8 through the interpreter registry. Capture the input
    // before recovery; callbacks may replace pending text or shift flags.
    const original=this.#pending;
    let pending:Uint8Array|ImmutableBytes;
    try {
      pending=original===undefined?new Uint8Array():serialize===undefined?encodeUtf8(original,"strict",meter):serialize(original);
    }catch(error){
      // A serialization service can cancel and fail together. Preserve an
      // existing fatal error; ordinary failures cannot mask termination.
      if(!(error instanceof ExecutionLimitError))meter.checkpoint();
      throw error;
    }
    // Empty serialized text skips the packing loop, but still crosses the
    // service boundary. Observe cancellation before returning any state.
    meter.checkpoint();
    if(pending.length>8){
      meter.checkpoint(0,524);
      throw new PythonEncodeError("gb2312",original!,0,original!.length,"pending buffer too large");
    }
    let state=this.#state<<BigInt((pending.length+1)*8);
    for(let index=0;index<pending.length;index++){
      meter.checkpoint(1,128);
      state|=BigInt(pending instanceof Uint8Array?pending[index]:pending.byteAt(BigInt(index),meter))<<BigInt((index+1)*8);
    }
    return state|BigInt(pending.length);
  }

  setstate(state:bigint,meter:ExecutionMeter,recover?:Utf8DecodeRecovery):void {
    meter.checkpoint();
    // Rejections own exception storage even when no pending bytes are copied.
    if(state<0n){meter.checkpoint(0,192);throw new PythonRuntimeError("OverflowError","can't convert negative int to unsigned");}
    // CPython allocates 1 length byte, 2*4 pending UTF-8 bytes and 8 state
    // bytes. Unused high bytes inside that 17-byte conversion are discarded.
    if(state>=(1n<<136n)){meter.checkpoint(0,192);throw new PythonRuntimeError("OverflowError","int too big to convert");}
    const length=Number(state&255n);
    if(length>8){meter.checkpoint(0,192);throw new PythonRuntimeError("UnicodeError","pending buffer too large");}
    meter.checkpoint(1,64+length);
    const bytes=new Uint8Array(length);
    meter.checkpoint(0,128);
    for(let index=0;index<length;index++){
      meter.checkpoint(1,32);
      bytes[index]=Number((state>>BigInt((index+1)*8))&255n);
    }
    // The owning interpreter resolves strict recovery for state UTF-8; the
    // encoder's multibyte errors policy does not apply to this conversion.
    const pending=decodeUtf8(bytes,recover??"strict",meter).text;
    this.#pending=pending;
    this.#state=(state>>BigInt((length+1)*8))&((1n<<64n)-1n);
  }

  reset(meter:ExecutionMeter):void {
    meter.checkpoint();
    this.#pending=undefined;
  }
}
