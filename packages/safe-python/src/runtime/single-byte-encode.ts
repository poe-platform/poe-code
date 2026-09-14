import type {CodePointString} from "./code-point-string.js";
import {PythonEncodeError} from "./encode-error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import type {Utf8EncodeErrors,Utf8EncodeRecovery} from "./utf8-encode.js";

/** Metered ASCII/Latin-1 codec kernel. Unicode canonical-name lookup is supplied
 * explicitly, rather than inferred from the host locale or name aliases. */
export function encodeSingleByte(text:CodePointString,encoding:"ascii"|"latin-1",errors:Utf8EncodeErrors|Utf8EncodeRecovery,meter:ExecutionMeter,name?:(point:number)=>string|undefined,recover?:Utf8EncodeRecovery):Uint8Array {
  let fatal=false;
  try{
    meter.checkpoint(1,32);
    const limit=encoding==="ascii"?128:256,output:number[]=[];
    for(let index=0;index<text.length;){
      const point=text.codePointAt(BigInt(index),meter);
      if(point<limit){meter.checkpoint(0,8);output.push(point);index++;continue;}
      if(errors==="surrogateescape"&&point>=0xdc80&&point<=0xdcff){meter.checkpoint(0,8);output.push(point-0xdc00);index++;continue;}
      let end=index+1;
      while(end<text.length&&text.codePointAt(BigInt(end),meter)>=limit)end++;
      const recoveryHandler=typeof errors==="function"?errors:errors==="surrogateescape"?recover:undefined;
      if(recoveryHandler!==undefined){
        const error=new PythonEncodeError(encoding,text,index,end,`ordinal not in range(${limit})`);
        const recovery=recoveryHandler(error);
        meter.checkpoint();
        const replacement=recovery.replacement;
        if(!(replacement instanceof Uint8Array)){
          // Native replacement validation uses the Unicode allocation kind
          // for Latin-1 and the ASCII flag for ASCII, including recovered text.
          if(encoding==="latin-1"?replacement.compactWidth(meter)!==1:!replacement.isAsciiStorage(meter)){
            recovery.rejectReplacement?.();
            throw recovery.failure??error;
          }
        }
        for(const byte of replacement){meter.checkpoint(1,8);output.push(byte);}
        index=recovery.position;
        continue;
      }
      if(errors==="strict"||errors==="surrogatepass"||errors==="surrogateescape")throw new PythonEncodeError(encoding,text,index,end,`ordinal not in range(${limit})`);
      for(;index<end;index++){
        meter.checkpoint();
        if(errors==="ignore")continue;
        if(errors==="replace"){meter.checkpoint(0,8);output.push(63);continue;}
        const point=text.codePointAt(BigInt(index),meter);let replacement:string;
        if(errors==="xmlcharrefreplace")replacement=`&#${point};`;
        else{
          let canonical:string|undefined;
          if(errors==="namereplace"){
            if(name===undefined)throw Error("name replacement requires a canonical Unicode-name policy");
            canonical=name(point);meter.checkpoint();
          }
          replacement=canonical===undefined?`\\${point<=0xff?"x":point<=0xffff?"u":"U"}${point.toString(16).padStart(point<=0xff?2:point<=0xffff?4:8,"0")}`:`\\N{${canonical}}`;
        }
        meter.checkpoint(0,64+replacement.length*2);
        for(let offset=0;offset<replacement.length;offset++){meter.checkpoint(1,8);output.push(replacement.charCodeAt(offset));}
      }
    }
    // The returned typed array owns metadata independently of its payload,
    // including an empty encoding or an error handler's empty replacement.
    meter.checkpoint(output.length,64+output.length);
    return Uint8Array.from(output);
  }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
  finally{if(!fatal)meter.checkpoint();}
}
