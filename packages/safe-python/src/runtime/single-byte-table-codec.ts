import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError,type DecodeErrorLocation} from "./decode-error.js";
import {PythonEncodeError,type EncodeErrorLocation} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import type {Utf8EncodeErrors,Utf8EncodeRecovery} from "./utf8-encode.js";
import type {Utf8Decoded,Utf8DecodeRecovery} from "./utf8-decode.js";

/** Pinned compiled single-byte maps, not Python's arbitrary mapping protocol.
 * Recovery callbacks use the same validated registry boundary as Unicode
 * kernels. Each owner copies its tables; guest buffers never alias them. */
export class SingleByteTableCodec {
  readonly #decode:readonly (number|null)[];
  readonly #encode:ReadonlyMap<number,number>;

  constructor(table:{readonly decode:readonly (number|null)[];readonly encode:readonly (readonly [number,number])[]},meter:ExecutionMeter){
    meter.checkpoint(table.decode.length+table.encode.length,table.decode.length*8+table.encode.length*64);
    this.#decode=table.decode.slice();
    this.#encode=new Map(table.encode);
  }

  decode(input:Uint8Array,errors:Utf8EncodeErrors|Utf8DecodeRecovery,meter:ExecutionMeter):Utf8Decoded {
    let fatal=false;
    try{
      meter.checkpoint(1,32);
      const consumed=input.length,points:number[]=[];
      let initial:DecodeErrorLocation|undefined;
      for(let index=0;index<input.length;){
        meter.checkpoint();
        const byte=input[index],point=this.#decode[byte];
        if(point!==null&&point!==undefined){meter.checkpoint(0,8);points.push(point);index++;continue;}
        // Retain the first callback fault for args when a later undefined ASCII
        // byte cannot be recovered by surrogateescape (for example in cp424).
        if(errors==="surrogateescape"&&initial===undefined){
          meter.checkpoint(0,48);initial={start:index,end:index+1,reason:"character maps to <undefined>"};
        }
        const error=new PythonDecodeError("charmap",input,index,index+1,"character maps to <undefined>",meter,initial);
        if(typeof errors==="function"){
          const recovery=errors(error);meter.checkpoint();
          for(const point of recovery.replacement){meter.checkpoint(1,8);points.push(point);}
          input=recovery.input;index=recovery.position;continue;
        }
        if(errors==="replace"){meter.checkpoint(0,8);points.push(0xfffd);}
        else if(errors==="surrogateescape"&&byte>=128){meter.checkpoint(0,8);points.push(0xdc00+byte);}
        else if(errors==="backslashreplace"){
          meter.checkpoint(0,32);points.push(92,120,"0123456789abcdef".charCodeAt(byte>>4),"0123456789abcdef".charCodeAt(byte&15));
        }else if(errors==="xmlcharrefreplace"||errors==="namereplace"){
          // Rejecting an encode-only policy creates a second exception in
          // addition to the Unicode fault above. Admit it before it can escape.
          meter.checkpoint(0,192);
          throw new PythonRuntimeError("TypeError","don't know how to handle UnicodeDecodeError in error callback");
        }
        else if(errors!=="ignore")throw error;
        index++;
      }
      // The result owns its record, string wrapper and two typed arrays even
      // for empty text. CodePointString separately admits the copied payload.
      meter.checkpoint(points.length,192+points.length*4);
      return {text:new CodePointString(Uint32Array.from(points),meter),consumed};
    }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally{if(!fatal)meter.checkpoint();}
  }

  encode(input:CodePointString,errors:Utf8EncodeErrors|Utf8EncodeRecovery,meter:ExecutionMeter,name?:(point:number)=>string|undefined):Uint8Array {
    let fatal=false;
    try{
      meter.checkpoint(1,32);
      const output:number[]=[];
      let initial:EncodeErrorLocation|undefined;
      for(let index=0;index<input.length;){
        const point=input.codePointAt(BigInt(index),meter),byte=this.#encode.get(point);
        if(byte!==undefined){meter.checkpoint(0,8);output.push(byte);index++;continue;}
        let end=index+1;
        while(end<input.length&&!this.#encode.has(input.codePointAt(BigInt(end),meter)))end++;
        // Unlike ASCII/Latin-1/UTF-8 fast paths, charmap invokes the handler
        // for escaped surrogates too, retaining that first exception's args.
        if(errors==="surrogateescape"&&initial===undefined){
          meter.checkpoint(0,48);initial={start:index,end,reason:"character maps to <undefined>"};
        }
        // Fault records and their diagnostics allocate before recovery, even
        // when a callback returns no replacement or raises its own exception.
        // Admit them before a catchable failure or guest side effect can escape.
        meter.checkpoint(0,512);
        const error=new PythonEncodeError("charmap",input,index,end,"character maps to <undefined>",initial);
        let replacement:CodePointString|Uint8Array;
        let recovery:ReturnType<Utf8EncodeRecovery>|undefined;
        if(typeof errors==="function"){
          recovery=errors(error);meter.checkpoint();replacement=recovery.replacement;
        }else if(errors==="ignore"){index=end;continue;}
        else if(errors==="surrogateescape"){
          meter.checkpoint(end-index,end-index);
          const bytes=new Uint8Array(end-index);
          for(let offset=index;offset<end;offset++){
            const point=input.codePointAt(BigInt(offset),meter);
            if(point<0xdc80||point>0xdcff)throw error;
            bytes[offset-index]=point-0xdc00;
          }
          replacement=bytes;
        }else if(errors==="strict"||errors==="surrogatepass")throw error;
        else{
          const points:number[]=[];meter.checkpoint(1,32);
          for(let offset=index;offset<end;offset++){
            const point=input.codePointAt(BigInt(offset),meter);
            let fragment:string;
            if(errors==="replace")fragment="?";
            else if(errors==="xmlcharrefreplace")fragment=`&#${point};`;
            else{
              let canonical:string|undefined;
              if(errors==="namereplace"){
                if(name===undefined)throw new Error("name replacement requires a canonical Unicode-name policy");
                canonical=name(point);meter.checkpoint();
              }
              fragment=canonical===undefined?`\\${point<=0xff?"x":point<=0xffff?"u":"U"}${point.toString(16).padStart(point<=0xff?2:point<=0xffff?4:8,"0")}`:`\\N{${canonical}}`;
            }
            meter.checkpoint(1,64+fragment.length*2);
            for(let offset=0;offset<fragment.length;offset++){meter.checkpoint(1,8);points.push(fragment.charCodeAt(offset));}
          }
          meter.checkpoint(points.length,points.length*4);
          replacement=new CodePointString(Uint32Array.from(points),meter);
        }
        for(const point of replacement){
          meter.checkpoint(1,8);
          const byte=replacement instanceof Uint8Array?point:this.#encode.get(point);
          if(byte===undefined){recovery?.rejectReplacement?.();throw recovery?.failure??error;}
          output.push(byte);
        }
        index=recovery?.position??end;
      }
      // Admit the returned typed-array header as well as its byte payload,
      // including after a callback has consumed the remaining budget.
      meter.checkpoint(output.length,64+output.length);
      return Uint8Array.from(output);
    }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
    finally{if(!fatal)meter.checkpoint();}
  }
}
