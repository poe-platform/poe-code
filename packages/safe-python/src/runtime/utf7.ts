import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError,type DecodeErrorLocation} from "./decode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import type {Utf8DecodeErrors} from "./utf8-decode.js";

export type Utf7DecodeRecovery=(error:PythonDecodeError)=>{replacement:CodePointString;position:number;input:Uint8Array};
type DecodeErrors=Utf8DecodeErrors|"xmlcharrefreplace"|"namereplace"|Utf7DecodeRecovery;
const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** UTF-7 emits UTF-16 units, including lone surrogates. Error callbacks are
 * therefore never needed by the encoder. Each call terminates its shift run,
 * including calls made by Python's stateless incremental encoder. */
export function encodeUtf7(input:CodePointString,meter?:ExecutionMeter):Uint8Array {
  meter?.checkpoint(1,64+input.length*8);
  const output=new Uint8Array(input.length*8);
  let written=0,shift=false,bits=0,buffer=0;
  const unit=(point:number)=>{
    buffer=(buffer<<16)|point;bits+=16;
    while(bits>=6){meter?.checkpoint();bits-=6;output[written++]=alphabet.charCodeAt((buffer>>>bits)&63);}
    buffer&=(1<<bits)-1;
  };
  for(const point of input){
    meter?.checkpoint();
    const direct=point>=32&&point<=125&&point!==43&&point!==92||point===9||point===10||point===13;
    if(shift&&direct){
      if(bits)output[written++]=alphabet.charCodeAt((buffer<<(6-bits))&63);
      bits=0;buffer=0;shift=false;
      if(base64Value(point)>=0||point===45)output[written++]=45;
      output[written++]=point;
    }else if(!shift&&point===43){output[written++]=43;output[written++]=45;}
    else if(!shift&&direct)output[written++]=point;
    else{
      if(!shift){output[written++]=43;shift=true;}
      if(point>=0x10000){unit(0xd800+((point-0x10000)>>10));unit(0xdc00+((point-0x10000)&1023));}
      else unit(point);
    }
  }
  if(bits)output[written++]=alphabet.charCodeAt((buffer<<(6-bits))&63);
  if(shift)output[written++]=45;
  // The returned slice owns a second buffer, even for an empty encoding.
  meter?.checkpoint(written,64+written);
  return output.slice(0,written);
}

/** Incomplete runs roll back both output and consumption to their '+' when
 * final is false. Recovery receives the full fault span after any complete
 * characters already emitted from that run, and may replace the input object.
 * Guest return/position validation belongs to RuntimeCodecRecovery. */
export function decodeUtf7(input:Uint8Array,errors:DecodeErrors="strict",meter?:ExecutionMeter,final=true):{text:CodePointString;consumed:number} {
  meter?.checkpoint(1,64+input.length*4);
  const originalLength=input.length;
  let output=new Uint32Array(input.length),written=0,index=0,minimumMaximum=127;
  let shift=false,shiftStart=0,shiftOutput=0,bits=0,buffer=0,surrogate=0;
  let initial:DecodeErrorLocation|undefined;
  const append=(point:number)=>{
    meter?.checkpoint();
    if(written===output.length){
      const capacity=Math.max(16,output.length*2);meter?.checkpoint(written+1,64+capacity*4);
      const grown=new Uint32Array(capacity);grown.set(output);output=grown;
    }
    output[written++]=point;
  };
  const recover=(start:number,end:number,reason:string)=>{
    if(errors==="ignore"){index=end;return;}
    if(errors==="replace"){append(0xfffd);index=end;return;}
    if(errors==="backslashreplace"){
      for(let offset=start;offset<end;offset++){
        const byte=input[offset];append(92);append(120);
        append("0123456789abcdef".charCodeAt(byte>>4));append("0123456789abcdef".charCodeAt(byte&15));
      }
      index=end;return;
    }
    if(errors==="surrogateescape"&&input[start]>=128){
      if(initial===undefined){meter?.checkpoint(0,48);initial={start,end,reason};}
      index=start;
      while(index<end&&index<start+4&&input[index]>=128)append(0xdc00+input[index++]);
      return;
    }
    if(errors==="xmlcharrefreplace"||errors==="namereplace"){
      // This rejection bypasses PythonDecodeError construction, which normally
      // admits fault storage. Exhaustion must stay fatal on this path too.
      meter?.checkpoint(0,320);
      throw new PythonRuntimeError("TypeError","don't know how to handle UnicodeDecodeError in error callback");
    }
    const error=new PythonDecodeError("utf7",input,start,end,reason,meter,initial);
    if(typeof errors!=="function")throw error;
    let fatal=false,result:ReturnType<Utf7DecodeRecovery>;
    try{result=errors(error);}
    catch(failure){fatal=failure instanceof ExecutionLimitError;throw failure;}
    finally{if(!fatal)meter?.checkpoint();}
    if(result.replacement.length!==0)minimumMaximum=Math.max(minimumMaximum,result.replacement.storageMaximum(meter));
    for(const point of result.replacement)append(point);
    input=result.input;index=result.position;
  };
  while(true){
    if(index>=input.length){
      if(shift&&final){
        shift=false;
        if(surrogate||bits>=6||bits>0&&buffer!==0){
          recover(shiftStart,originalLength,"unterminated shift sequence");
          if(index<input.length)continue;
        }
      }
      break;
    }
    meter?.checkpoint();
    const point=input[index],value=base64Value(point);
    if(shift){
      if(value>=0){
        buffer=(buffer<<6)|value;bits+=6;index++;
        if(bits>=16){
          bits-=16;const unit=buffer>>>bits;buffer&=(1<<bits)-1;
          if(surrogate){
            if(unit>=0xdc00&&unit<=0xdfff){append(0x10000+((surrogate-0xd800)<<10)+unit-0xdc00);surrogate=0;continue;}
            append(surrogate);surrogate=0;
          }
          if(unit>=0xd800&&unit<=0xdbff)surrogate=unit;
          else append(unit);
        }
      }else{
        shift=false;
        if(bits>=6){recover(shiftStart,index+1,"partial character in shift sequence");continue;}
        if(bits>0&&buffer!==0){recover(shiftStart,index+1,"non-zero padding bits in shift sequence");continue;}
        if(surrogate&&point<=127&&point!==43)append(surrogate);
        surrogate=0;
        if(point===45)index++;
      }
    }else if(point===43){
      shiftStart=index++;
      if(index<input.length&&input[index]===45){index++;append(43);}
      else if(index<input.length&&base64Value(input[index])<0)recover(shiftStart,index+1,"ill-formed sequence");
      else{shift=true;surrogate=0;shiftOutput=written;bits=0;buffer=0;}
    }else if(point<=127){index++;append(point);}
    else recover(index,index+1,"unexpected special character");
  }
  if(shift){index=shiftStart;written=shiftOutput;}
  // Admit the result record, point-string object and temporary view before
  // publication. CodePointString separately charges its owned point payload.
  meter?.checkpoint(1,128);
  return {text:CodePointString.fromUnicodeWriter(output.subarray(0,written),minimumMaximum,meter),consumed:final?originalLength:index};
}

/** Buffer ownership and successful-call commit semantics for the guest
 * BufferedIncrementalDecoder. Its second state item is ignored by Python. */
export class Utf7Decoder {
  #pending=new Uint8Array();
  constructor(public errors:DecodeErrors="strict") {}

  decode(input:Uint8Array,final=false,meter?:ExecutionMeter):CodePointString {
    meter?.checkpoint();
    let combined=input;
    if(this.#pending.length){
      const size=this.#pending.length+input.length;meter?.checkpoint(size,64+size);
      combined=new Uint8Array(size);combined.set(this.#pending);combined.set(input,this.#pending.length);
    }
    const result=decodeUtf7(combined,this.errors,meter,final);
    const remaining=Math.max(0,combined.length-result.consumed);meter?.checkpoint(remaining+1,64+remaining);
    this.#pending=combined.slice(result.consumed);
    return result.text;
  }

  getstate(meter?:ExecutionMeter):readonly [Uint8Array,bigint] {
    // The pair and owned buffer allocate even when no shift run is pending.
    meter?.checkpoint(this.#pending.length+1,96+this.#pending.length);
    return [this.#pending.slice(),0n];
  }

  setstate(state:readonly [Uint8Array,bigint],meter?:ExecutionMeter):void {
    meter?.checkpoint(state[0].length+1,64+state[0].length);
    this.#pending=new Uint8Array(state[0]);
  }

  reset(meter?:ExecutionMeter):void {meter?.checkpoint(1,64);this.#pending=new Uint8Array();}
}

function base64Value(point:number):number {
  if(point>=65&&point<=90)return point-65;
  if(point>=97&&point<=122)return point-97+26;
  if(point>=48&&point<=57)return point-48+52;
  return point===43?62:point===47?63:-1;
}
