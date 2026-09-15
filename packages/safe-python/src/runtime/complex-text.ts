import type { CodePointString } from "./code-point-string.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { parseFloatText } from "./float-text.js";
import { isUnicodeWhitespace } from "./unicode-whitespace.js";
import { unicodeDecimal } from "./unicode-decimal.js";
import { renderQuotedPoints } from "./quoted-representation.js";

/** Complex constructor strings allow one parenthesis pair and outer whitespace,
 * but none between numeric components. Float grammar owns Unicode decimals,
 * underscores, non-finite values and binary64 rounding. */
export function parseComplexText(source:CodePointString,meter:ExecutionMeter):{readonly real:number;readonly imaginary:number} {
  meter.checkpoint(1,64);
  const invalid=():never=>{throw new PythonRuntimeError("ValueError","complex() arg is a malformed string");};
  const point=(index:number):number=>source.codePointAt(BigInt(index),meter);
  const whitespace=(value:number):boolean=>value===32||(value>=9&&value<=13)||(value>127&&isUnicodeWhitespace(value));
  // CPython's underscore prepass stops at the first null, before grammar
  // validation. It reports invalid separators using the original string.
  for(let index=0;index<source.length;index++) {
    const value=point(index);meter.checkpoint();
    if(value===0)break;
    if(value===95&&(index===0||index+1===source.length||unicodeDecimal(point(index-1),meter)<0||unicodeDecimal(point(index+1),meter)<0)) {
      let representation="";
      for(const point of renderQuotedPoints(source,"repr",meter)){meter.checkpoint(1,point>0xffff?4:2);representation+=String.fromCodePoint(point);}
      throw new PythonRuntimeError("ValueError",`could not convert string to complex: ${representation}`);
    }
  }
  let start=0,end=source.length;
  while(start<end&&whitespace(point(start))){meter.checkpoint();start++;}
  while(end>start&&whitespace(point(end-1))){meter.checkpoint();end--;}
  if(start===end)return invalid();
  if(point(start)===40) {
    if(point(end-1)!==41)return invalid();
    start++;end--;
    while(start<end&&whitespace(point(start))){meter.checkpoint();start++;}
    while(end>start&&whitespace(point(end-1))){meter.checkpoint();end--;}
  }
  if(start===end)return invalid();
  for(let index=start;index<end;index++){meter.checkpoint();if(whitespace(point(index)))return invalid();}
  const component=(from:number,to:number):number=>{
    const input=source.slice(BigInt(from),BigInt(to),null,meter);
    try{return parseFloatText(input,meter);}
    catch(error){if(error instanceof PythonRuntimeError&&error.name==="ValueError")return invalid();throw error;}
  };
  if((point(end-1)|32)!==106)return {real:component(start,end),imaginary:0};
  end--;
  let separator=-1;
  for(let index=start+1;index<end;index++) {
    const value=point(index);meter.checkpoint();
    if((value===43||value===45)&&(point(index-1)|32)!==101){if(separator!==-1)return invalid();separator=index;}
  }
  const imaginaryStart=separator===-1?start:separator;
  const real=separator===-1?0:component(start,separator);
  const imaginary=end===imaginaryStart?1:end===imaginaryStart+1&&(point(imaginaryStart)===43||point(imaginaryStart)===45)?point(imaginaryStart)===45?-1:1:component(imaginaryStart,end);
  return {real,imaginary};
}
