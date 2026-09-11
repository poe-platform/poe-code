import type {CodePointString} from "./code-point-string.js";
import {PythonEncodeError} from "./encode-error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import type {Utf8EncodeErrors} from "./utf8-encode.js";

/** Metered ASCII/Latin-1 codec kernel. Unicode canonical-name lookup is supplied
 * explicitly, rather than inferred from the host locale or name aliases. */
export function encodeSingleByte(text:CodePointString,encoding:"ascii"|"latin-1",errors:Utf8EncodeErrors,meter:ExecutionMeter,name?:(point:number)=>string|undefined):Uint8Array {
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
    meter.checkpoint(output.length,output.length);
    return Uint8Array.from(output);
  }catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
  finally{if(!fatal)meter.checkpoint();}
}
