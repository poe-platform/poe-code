import {PythonSource, PythonSyntaxError, type SourcePosition} from "./source.js";
import {decodeStringLiteral} from "./string-literal-decoding.js";

/** Decode a tokenizer-delimited segment at its grammar reduction. Ordinary
 * parts use the closing quote's diagnostic span; format parts propagate the
 * UnicodeDecodeError, as CPython's decoded_constant_from_token does. */
export function decodeInterpolatedLiteral(content:string, raw:boolean, source:PythonSource,
  diagnostic:{readonly start:SourcePosition;readonly end:SourcePosition}, format:boolean,implicitNewline:boolean,
  onWarning?: (message:string,position:SourcePosition)=>void):Uint32Array {
  const literal=new PythonSource(content,source.filename,source.meter);
  const start={offset:0,line:1,column:0};
  while(!literal.done)literal.advance();
  const end=literal.position;
  return decodeStringLiteral(literal,start,end,start,end,false,raw,(message,position)=>{
    source.meter?.checkpoint(0,48);
    onWarning?.(message,{offset:diagnostic.start.offset,
      line:diagnostic.start.line+position.line-1,column:position.column});
  },error=>{
    if(format)throw error;
    source.meter?.checkpoint(0,256+2*error.message.length);
    throw new PythonSyntaxError(`(unicode error) ${error.message}`,source.filename,diagnostic.start,diagnostic.end)
      .withSource(source.text,implicitNewline,source.meter);
  }) as Uint32Array;
}
