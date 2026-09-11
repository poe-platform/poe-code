import {detectSourceEncoding} from "../source-encoding.js";
import {PythonSyntaxError} from "../source.js";
import {PythonDecodeError} from "./decode-error.js";
import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {decodeUtf8} from "./utf8-decode.js";

/** Additional codec capability. Input is an owned snapshot of the byte source.
 * Return undefined for an unknown codec. Implementations own their work and
 * output allocation charges; no filesystem or host codec is implicitly loaded.
 */
export type SourceByteDecoder=(encoding:string,source:Uint8Array,meter:ExecutionMeter)=>string|undefined;

const codecs=new Map<string,"utf-8"|"latin-1"|"ascii">([
  ...["utf_8","u8","utf","utf8","utf8_ucs2","utf8_ucs4","cp65001"].map(name=>[name,"utf-8"] as const),
  ...["latin_1","8859","cp819","csisolatin1","ibm819","iso8859","iso8859_1","iso_8859_1","iso_8859_1_1987","iso_ir_100","l1","latin","latin1"].map(name=>[name,"latin-1"] as const),
  ...["ascii","646","ansi_x3.4_1968","ansi_x3_4_1968","ansi_x3.4_1986","cp367","csascii","ibm367","iso646_us","iso_646.irv_1991","iso_ir_6","us","us_ascii"].map(name=>[name,"ascii"] as const)
]);

/** Decode bytes before parsing, without treating coding comments in str input
 * as active declarations. Strict failures remain catchable Python syntax errors.
 */
export function decodeByteSource(source:Uint8Array,filename:string,meter:ExecutionMeter,decode?:SourceByteDecoder):string {
  let fatal=false;
  try {
    meter.checkpoint(1,128+source.length);
    const snapshot=new Uint8Array(source.length);
    for(let index=0;index<source.length;index++){
      meter.checkpoint();
      const byte=source[index];
      if(byte===0){meter.checkpoint(0,320);throw new PythonSyntaxError("source code string cannot contain null bytes",filename,{offset:0,line:1,column:0});}
      snapshot[index]=byte;
    }
    const {encoding}=detectSourceEncoding(snapshot,{filename,meter});
    meter.checkpoint(1,96+68*encoding.length);
    let normalized="",separator=false;
    for(const character of encoding){
      meter.checkpoint();
      if(character==="-"||character==="_"){separator=normalized.length>0;continue;}
      if(separator)normalized+="_";
      normalized+=character.toLowerCase();separator=false;
    }
    // Preserve an initial BOM in decoded text: PythonSource consumes it exactly
    // once. Removing it here too would incorrectly accept two initial BOMs.
    const codec=codecs.get(normalized),input=snapshot;
    if(codec===undefined){
      const result=decode?.(encoding,input,meter);
      meter.checkpoint();
      if(result!==undefined){
        if(typeof result!=="string")throw new TypeError("source codec must return text or undefined");
        return result;
      }
      meter.checkpoint(0,320+2*encoding.length);
      throw new PythonSyntaxError(`unknown encoding: ${encoding}`,filename,{offset:0,line:0,column:-2});
    }
    meter.checkpoint(1,128+68*input.length);
    const points=codec==="utf-8"?decodeUtf8(input,"strict",meter).text:input;
    let text="";
    let index=0;
    for(const point of points){
      meter.checkpoint();
      if(codec==="ascii"&&point>127)throw new PythonDecodeError("ascii",input,index,index+1,"ordinal not in range(128)",meter);
      text+=String.fromCodePoint(point);index++;
    }
    return text;
  } catch(error){
    fatal=error instanceof ExecutionLimitError;
    if(error instanceof PythonDecodeError){
      meter.checkpoint(0,320+2*error.message.length);
      throw new PythonSyntaxError(error.message,filename,{offset:0,line:0,column:-2});
    }
    throw error;
  } finally {if(!fatal)meter.checkpoint();}
}
