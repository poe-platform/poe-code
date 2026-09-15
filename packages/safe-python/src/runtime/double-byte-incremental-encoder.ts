import type {ImmutableBytes} from "./immutable-bytes.js";
import type {CodePointString} from "./code-point-string.js";
import {DoubleByteEncodeBuffer,type DoubleByteCodec,type MultibyteEncodeRecovery,type MultibyteErrors} from "./double-byte-codec.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {decodeUtf8,type Utf8DecodeRecovery} from "./utf8-decode.js";
import {encodeUtf8} from "./utf8-encode.js";

/** Native multibyte encoder state after guest argument conversion.
 * Injected pending text is UTF-8 in the low bytes of an unsigned 136-bit
 * integer. Eight opaque bytes follow it; extra high bytes are ignored.
 * Encoding captures errors once, unlike incremental decoding's live policy. */
export class DoubleByteIncrementalEncoder {
  #pending:CodePointString|undefined;
  readonly #state={value:0n};

  constructor(readonly codec:DoubleByteCodec,public errors:MultibyteErrors|MultibyteEncodeRecovery="strict") {
    this.#state.value=codec.shift?.encoderInitialState??0n;
  }

  encode(input:CodePointString,final:boolean,meter:ExecutionMeter):Uint8Array {
    meter.checkpoint();
    const original=this.#pending;
    let combined=input;
    if(original!==undefined){
      combined=original.concat(input,meter);
      this.#pending=undefined;
    }
    const buffer=new DoubleByteEncodeBuffer(this.codec,combined,meter,this.#state);
    let output:Uint8Array;
    try {
      buffer.feed(this.errors,final);
      output=buffer.finish();
    }catch(error){
      this.#pending=original;
      if(!(error instanceof ExecutionLimitError))meter.checkpoint();
      throw error;
    }
    if(buffer.position<combined.length){
      if(combined.length-buffer.position>2)throw new PythonEncodeError(this.codec.name,combined,buffer.position,combined.length,"pending buffer overflow");
      this.#pending=combined.slice(BigInt(buffer.position),null,null,meter);
    }
    return output;
  }

  getstate(meter:ExecutionMeter,serialize?:(text:CodePointString)=>ImmutableBytes):bigint {
    // Admit the bounded bigint temporaries as well as the empty typed array
    // used when no text is pending. Nonempty UTF-8 storage is charged below.
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
      meter.checkpoint(0,512+2*this.codec.name.length);
      throw new PythonEncodeError(this.codec.name,original!,0,original!.length,"pending buffer too large");
    }
    let state=this.#state.value;
    for(let index=pending.length-1;index>=0;index--){meter.checkpoint(1,128);state=(state<<8n)|BigInt(pending instanceof Uint8Array?pending[index]:pending.byteAt(BigInt(index),meter));}
    return (state<<8n)|BigInt(pending.length);
  }

  setstate(state:bigint,meter:ExecutionMeter,recover?:Utf8DecodeRecovery):void {
    meter.checkpoint(1,32);
    // State validation may reject before any pending-buffer allocation. Admit
    // each fault before it can escape as a catchable guest exception.
    if(state<0n){meter.checkpoint(0,192);throw new PythonRuntimeError("OverflowError","can't convert negative int to unsigned");}
    if(state>=(1n<<136n)){meter.checkpoint(0,192);throw new PythonRuntimeError("OverflowError","int too big to convert");}
    const length=Number(state&255n);
    if(length>8){meter.checkpoint(0,192);throw new PythonRuntimeError("UnicodeError","pending buffer too large");}
    meter.checkpoint(length,64+length);
    const bytes=new Uint8Array(length);
    meter.checkpoint(0,128*(length+1));
    state>>=8n;
    for(let index=0;index<length;index++){bytes[index]=Number(state&255n);state>>=8n;}
    // Pending state is decoded using the interpreter's strict UTF-8 handler,
    // independently of this encoder's errors policy. The binding supplies a
    // fresh registry recovery per operation; neither field commits on failure.
    const pending=decodeUtf8(bytes,recover??"strict",meter).text;
    this.#pending=pending;
    this.#state.value=state&((1n<<64n)-1n);
  }

  reset(meter:ExecutionMeter):void {
    meter.checkpoint();
    this.codec.shift?.reset(this.#state,meter);
    this.#pending=undefined;
  }
}
