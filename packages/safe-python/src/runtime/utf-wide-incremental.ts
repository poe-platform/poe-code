import type {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import type {Utf8DecodeErrors} from "./utf8-decode.js";
import type {Utf8EncodeErrors} from "./utf8-encode.js";
import {decodeWideUnicode,encodeWideUnicode,type UnicodeByteOrder,type WideDecodeRecovery,type WideEncodeRecovery} from "./utf-wide.js";

/** Internal codec state kernels. Guest classes own descriptor and argument
 * validation; state here uses already validated bytes and Python integers. */
export class WideUnicodeDecoder {
  #pending=new Uint8Array();
  #order:UnicodeByteOrder;

  constructor(readonly width:16|32,readonly byteorder:UnicodeByteOrder=0,public errors:Utf8DecodeErrors|WideDecodeRecovery="strict") {this.#order=byteorder;}

  decode(input:Uint8Array,final=false,meter?:ExecutionMeter):CodePointString {
    meter?.checkpoint();
    let combined=input;
    if(this.#pending.length){
      const size=this.#pending.length+input.length;meter?.checkpoint(size,64+size);
      combined=new Uint8Array(size);combined.set(this.#pending);combined.set(input,this.#pending.length);
    }
    const order=this.#order;
    const result=decodeWideUnicode(combined,this.width,order,this.errors,meter,final);
    if(order===0&&result.byteorder===0&&result.consumed>=this.width/8){
      throw new PythonDecodeError(`utf-${this.width}`,combined,0,this.width/8,"Stream does not start with BOM",meter);
    }
    const remaining=Math.max(0,combined.length-result.consumed);meter?.checkpoint(remaining+1,64+remaining);
    const pending=combined.slice(result.consumed);
    // Prepare both state fields before publishing either: a final budget or
    // cancellation failure must not pair old pending bytes with a new order.
    // Only initial BOM detection selects a decoder after the call. A recovery
    // callback can change the selected decoder; ordinary calls retain that
    // mutation while still committing their own buffered-byte remainder.
    if(order===0&&result.byteorder!==0)this.#order=result.byteorder;
    this.#pending=pending;
    return result.text;
  }

  getstate(meter?:ExecutionMeter):readonly [Uint8Array,bigint] {
    // State pairs and copied buffers allocate even with no pending bytes.
    meter?.checkpoint(this.#pending.length+1,96+this.#pending.length);
    return [this.#pending.slice(),this.byteorder!==0?0n:this.#order===0?2n:this.#order===-1?0n:1n];
  }

  setstate(state:readonly [Uint8Array,bigint],meter?:ExecutionMeter):void {
    meter?.checkpoint(state[0].length+1,64+state[0].length);
    this.#pending=new Uint8Array(state[0]);
    this.#order=this.byteorder!==0?this.byteorder:state[1]===0n?-1:state[1]===1n?1:0;
  }

  reset(meter?:ExecutionMeter):void {meter?.checkpoint(1,64);this.#pending=new Uint8Array();this.#order=this.byteorder;}
}

export class WideUnicodeEncoder {
  #order:UnicodeByteOrder;
  constructor(readonly width:16|32,readonly byteorder:UnicodeByteOrder=0,public errors:Utf8EncodeErrors|WideEncodeRecovery="strict") {this.#order=byteorder;}

  encode(input:CodePointString,_final=false,meter?:ExecutionMeter):Uint8Array {
    const order=this.#order;
    const result=encodeWideUnicode(input,this.width,order,this.errors,meter);
    if(order===0)this.#order=-1;
    return result;
  }

  getstate(meter?:ExecutionMeter):bigint {meter?.checkpoint();return this.#order===0?2n:0n;}
  setstate(state:bigint,meter?:ExecutionMeter):void {meter?.checkpoint();this.#order=this.byteorder!==0?this.byteorder:state===0n?-1:0;}
  reset(meter?:ExecutionMeter):void {meter?.checkpoint();this.#order=this.byteorder;}
}
