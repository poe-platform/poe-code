import {DoubleByteCodec,DoubleByteDecodeBuffer,type MultibyteDecodeRecovery,type MultibyteErrors} from "./double-byte-codec.js";
import type {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";

/** Native multibyte decoder state, after guest tuple/bytes/int validation.
 * Stateless double-byte codecs preserve their eight state bytes verbatim. */
export type DoubleByteDecoderState=readonly [Uint8Array,bigint];

export class DoubleByteIncrementalDecoder {
  #pending=new Uint8Array();
  readonly #state={value:0n};

  constructor(readonly codec:DoubleByteCodec,public errors:MultibyteErrors|MultibyteDecodeRecovery="strict") {
    this.#state.value=codec.shift?.decoderInitialState??0n;
  }

  decode(input:Uint8Array,final:boolean,meter:ExecutionMeter):CodePointString {
    meter.checkpoint();
    const original=this.#pending;
    let combined=input;
    if(original.length!==0){
      // Admit the merged storage and replacement empty pending buffer together,
      // before either allocation can precede a failed state transition.
      meter.checkpoint(original.length+input.length,128+original.length+input.length);
      combined=new Uint8Array(original.length+input.length);
      combined.set(original);
      combined.set(input,original.length);
      this.#pending=new Uint8Array();
    }
    const buffer=new DoubleByteDecodeBuffer(this.codec,combined,meter,this.#state);
    buffer.feed(this,false);
    if(final&&buffer.position<combined.length){
      try{buffer.recover(this.errors,true);}
      catch(error){this.#pending=original;throw error;}
    }
    const remaining=combined.length-buffer.position;
    if(remaining!==0){
      const length=this.#pending.length+remaining;
      if(length>8)throw new PythonDecodeError(this.codec.name,combined,0,combined.length,"pending buffer overflow",meter);
      meter.checkpoint(length,64+length);
      const pending=new Uint8Array(length);
      pending.set(this.#pending);
      pending.set(combined.subarray(buffer.position),this.#pending.length);
      this.#pending=pending;
    }
    return buffer.finish();
  }

  getstate(meter:ExecutionMeter):DoubleByteDecoderState {
    // Retained state owns both a pair and a buffer, including empty snapshots.
    meter.checkpoint(this.#pending.length+1,96+this.#pending.length);
    return [this.#pending.slice(),this.#state.value];
  }

  setstate(state:DoubleByteDecoderState,meter:ExecutionMeter):void {
    meter.checkpoint();
    // Integer rejection precedes byte-state validation and must own its fault
    // before exposing it; neither failure may mutate the retained state.
    if(state[1]<0n){meter.checkpoint(0,192);throw new PythonRuntimeError("OverflowError","can't convert negative int to unsigned");}
    if(state[1]>=(1n<<64n)){meter.checkpoint(0,192);throw new PythonRuntimeError("OverflowError","int too big to convert");}
    if(state[0].length>8)throw new PythonDecodeError(this.codec.name,state[0],0,state[0].length,"pending buffer too large",meter);
    meter.checkpoint(state[0].length,64+state[0].length);
    this.#pending=new Uint8Array(state[0]);
    this.#state.value=state[1];
  }

  reset(meter:ExecutionMeter):void {
    // Deny new buffer storage before the codec reset can mutate shift flags.
    meter.checkpoint(1,64);
    if(this.codec.shift?.resetDecoder!==undefined)this.codec.shift.resetDecoder(this.#state,meter);
    else this.codec.shift?.reset(this.#state,meter);
    this.#pending=new Uint8Array();
  }
}
