import {PythonSyntaxError, type PythonSource, type SourcePosition, type SourceMeter} from "./source.js";
import {decodeByteEscape} from "./runtime/byte-escape.js";
import {decodeUnicodeEscape} from "./runtime/unicode-escape.js";
import {PythonDecodeError} from "./runtime/decode-error.js";
import {PythonRuntimeError} from "./runtime/error.js";

/** Decode an already delimited token using the same escape kernels as codecs.
 * CPython expands literal non-ASCII text into Unicode escapes before decoding;
 * error byte offsets therefore address that expanded input, not UTF-8 source. */
export function decodeStringLiteral(source:PythonSource, contentStart:SourcePosition, contentEnd:SourcePosition,
  start:SourcePosition, end:SourcePosition, bytes:boolean, raw:boolean,
  onWarning?: (message:string, position:SourcePosition)=>void,
  onDecodeError?: (error:PythonDecodeError)=>never):Uint8Array|Uint32Array {
  const meter=source.meter;
  const input:number[]=[], positions:SourcePosition[]=[], points:number[]=[];
  let offset=contentStart.offset,line=contentStart.line,column=contentStart.column;
  const syntax=(message:string)=>{
    meter?.checkpoint(0,192+2*message.length);
    const error=new PythonSyntaxError(message,source.filename,start,end);
    // Multiline token diagnostics use the tokenizer's saved first line,
    // whose terminating newline is not part of that saved buffer.
    if(start.line!==end.line){
      let first=start.offset,last=start.offset;
      while(first>0&&source.text[first-1]!=="\n"&&source.text[first-1]!=="\r"){meter?.checkpoint();first--;}
      while(last<source.text.length&&source.text[last]!=="\n"&&source.text[last]!=="\r"){meter?.checkpoint();last++;}
      if(first===0&&source.text[0]==="\uFEFF")first++;
      meter?.checkpoint(0,32+2*(last-first));
      return error.withSourceLine(source.text.slice(first,last),meter);
    }
    return error.withSource(source.text,true,meter);
  };
  const append=(text:string,position:SourcePosition)=>{
    meter?.checkpoint(text.length,16*text.length);
    for(const character of text){input.push(character.charCodeAt(0));positions.push(position);}
  };
  while(offset<contentEnd.offset){
    meter?.checkpoint(1,48);
    const position={offset,line,column};
    let point=source.text.codePointAt(offset)!;
    offset+=point>0xffff?2:1;
    if(point===13){if(source.text.charCodeAt(offset)===10)offset++;point=10;}
    if(point===10){line++;column=0;}else column++;
    if(bytes&&point>127)throw syntax("bytes can only contain ASCII literal characters");
    if(raw){meter?.checkpoint(0,8);points.push(point);continue;}
    if(!bytes&&point===92){
      const next=source.text.codePointAt(offset);
      if(offset===contentEnd.offset||next!==undefined&&next>127){append("\\u005c",position);continue;}
      // A backslash followed by ASCII consumes that character as part of the
      // escape, so a second backslash is not reinterpreted before non-ASCII.
      append("\\",position);
      if(next!==undefined){
        let marker=next;offset++;
        if(marker===13){if(source.text.charCodeAt(offset)===10)offset++;marker=10;}
        append(String.fromCharCode(marker),position);
        if(marker===10){line++;column=0;}else column++;
      }
      continue;
    }
    append(!bytes&&point>127?`\\U${point.toString(16).padStart(8,"0")}`:String.fromCodePoint(point),position);
  }
  if(raw){meter?.checkpoint(points.length,points.length*(bytes?1:4));return bytes?Uint8Array.from(points):Uint32Array.from(points);}
  meter?.checkpoint(input.length,input.length);
  const encoded=Uint8Array.from(input);
  let warning:{marker:number;position:SourcePosition}|undefined;
  const warn=(_message:string,marker:number,index:number)=>{meter?.checkpoint(0,48);warning={marker,position:positions[index]};};
  let value:Uint8Array|Uint32Array;
  try {
    if(bytes)value=decodeByteEscape(encoded,"strict",meter??{checkpoint(){}},warn);
    else {
      const decoded=decodeUnicodeEscape(encoded,false,"strict",meter,true,warn).text;
      meter?.checkpoint(decoded.length,decoded.length*4);
      value=Uint32Array.from(decoded);
    }
  }catch(error){
    if(error instanceof PythonDecodeError){
      if(onDecodeError)return onDecodeError(error);
      throw syntax(`(unicode error) ${error.message}`);
    }
    if(error instanceof PythonRuntimeError&&error.name==="ValueError")throw syntax(`(value error) ${error.message}`);
    throw error;
  }
  if(warning){
    const {marker,position}=warning;
    onWarning?.(escapeWarning(marker>255?marker.toString(8):String.fromCharCode(marker),marker>255,meter),position);
  }
  meter?.checkpoint();
  return value;
}

export function escapeWarning(escape: string, octal = false,meter?:SourceMeter): string {
  meter?.checkpoint(1+escape.length,1024+8*escape.length);
  return `"\\${escape}" is an invalid ${octal ? "octal " : ""}escape sequence. ` +
    `Such sequences will not work in the future. Did you mean "\\\\${escape}"? A raw string is also an option.`;
}
