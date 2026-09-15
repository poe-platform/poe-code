import type {ImmutableBytes} from "./immutable-bytes.js";
import {decodeUtf8} from "./utf8-decode.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";

/** Python codec-registry spelling: collapse punctuation, preserve dots, treat
 * non-ASCII characters as punctuation, trim edge separators and fold ASCII case.
 * CPython normalizes the UTF-8 bytes before calling the codec registry. */
export function normalizeRuntimeEncodingName(name:string|ImmutableBytes,meter:ExecutionMeter):string {
  meter.checkpoint();
  let normalized="",separator=false;
  for(const character of name){
    const point=typeof character==="number"?character:character.codePointAt(0)!;meter.checkpoint(1,64);
    const asciiLetter=point>=65&&point<=90||point>=97&&point<=122,asciiDigit=point>=48&&point<=57;
    if(asciiLetter||asciiDigit||point===46){
      if(separator&&normalized.length)normalized+="_";
      normalized+=point>=65&&point<=90?String.fromCharCode(point+32):String.fromCodePoint(point);separator=false;
    }else separator=true;
  }
  return normalized;
}

/** Render native C-string bytes only at diagnostic boundaries with the pinned kernel. */
export function displayRuntimeEncodingName(name:string|ImmutableBytes,meter:ExecutionMeter,precision?:number):string {
  meter.checkpoint();
  if(typeof name==="string")return precision===undefined?name:diagnosticTypeName(name,meter,precision);
  // Native %.Ns limits the original C-string bytes before replacement decoding.
  // At the limit an incomplete final sequence is omitted; below it, the
  // NUL-terminated input is final and an incomplete sequence is replaced.
  const length=precision===undefined?name.length:Math.min(name.length,precision);
  meter.checkpoint(0,64+length);
  const bytes=new Uint8Array(length);
  let index=0;
  for(const byte of name){
    meter.checkpoint();
    if(index===length)break;
    bytes[index++]=byte;
  }
  let text="";
  for(const point of decodeUtf8(bytes,"replace",meter,length!==precision).text){
    meter.checkpoint(1,4);text+=String.fromCodePoint(point);
  }
  return text;
}
