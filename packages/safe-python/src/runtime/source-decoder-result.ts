import {PythonSyntaxError} from "../source.js";
import {CodePointString} from "./code-point-string.js";
import {PythonEncodeError} from "./encode-error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {encodeUtf8} from "./utf8-encode.js";

/** The tokenizer converts decoded text to strict UTF-8 before treating it as a
 * C string and translating newlines again. A decoded BOM is source content;
 * only the original byte buffer participates in file-signature detection. */
export function sourceDecoderResult(text:string|CodePointString,filename:string,meter:ExecutionMeter):string {
  for(const character of text){
    meter.checkpoint();
    const point=typeof character==="number"?character:character.codePointAt(0)!;
    if(point>=0xd800&&point<=0xdfff){
      try {encodeUtf8(typeof text==="string"?CodePointString.fromString(text,meter):text,"strict",meter);}
      catch(error){
        if(!(error instanceof PythonEncodeError))throw error;
        meter.checkpoint(0,320+2*error.message.length);
        throw new PythonSyntaxError(error.message,filename,{offset:0,line:0,column:-2});
      }
    }
  }
  // Only scalar-only text may cross the compiler's host-string boundary.
  // Converting first would combine adjacent guest high/low surrogates and
  // change both source validity and UnicodeEncodeError code-point offsets.
  if(typeof text!=="string"){
    const points=text;
    meter.checkpoint(1,32+4*points.length);
    text="";
    for(const point of points){meter.checkpoint();text+=String.fromCodePoint(point);}
  }
  // Validate the entire decoder result first, including text after a NUL.
  meter.checkpoint(1,34+2*text.length);
  let translated="";
  for(let index=0;index<text.length;index++){
    meter.checkpoint();
    const character=text[index];
    if(character==="\0")break;
    translated+=character==="\r"?"\n":character;
    if(character==="\r"&&text[index+1]==="\n")index++;
  }
  // PythonSource supplies the implicit final LF in exec mode, as it does for
  // native source decoding. Retain that shared internal source representation.
  if(translated.startsWith("\ufeff")){
    let end=0;
    while(end<translated.length&&translated[end]!=="\n"){meter.checkpoint();end++;}
    meter.checkpoint(0,320+2*end);
    const position={offset:0,line:1,column:0};
    throw new PythonSyntaxError("invalid non-printable character U+FEFF",filename,position,position).withSourceLine(translated.slice(0,end),meter);
  }
  return translated;
}
