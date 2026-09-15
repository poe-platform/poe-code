import {PythonSyntaxError} from "../source.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {decodeUtf8} from "./utf8-decode.js";

/** Attribute the first malformed sequence after native UTF-8 validation. Input
 * already has universal newlines; bytes before the fault are valid UTF-8. */
export function sourceUtf8Error(input:Uint8Array,badOffset:number,bomLength:number,filename:string,meter:ExecutionMeter):PythonSyntaxError {
  let line=1,column=0,start=bomLength;
  for(let index=bomLength;index<badOffset;index++){
    meter.checkpoint();
    const byte=input[index];
    if(byte===10){line++;column=0;start=index+1;}
    else if(byte<128||byte>=192)column++;
  }
  let end=badOffset;
  while(end<input.length&&input[end]!==10){meter.checkpoint();end++;}
  const points=decodeUtf8(input.subarray(start,end),"replace",meter).text;
  let text="";
  for(const point of points){meter.checkpoint(1,4);text+=String.fromCodePoint(point);}
  const message=`Non-UTF-8 code starting with '\\x${input[badOffset].toString(16).padStart(2,"0")}' on line ${line}, but no encoding declared; see https://peps.python.org/pep-0263/ for details`;
  meter.checkpoint(1,320+2*message.length);
  const position={offset:badOffset,line,column};
  return new PythonSyntaxError(message,filename,position,position,null).withSourceLine(text,meter);
}
