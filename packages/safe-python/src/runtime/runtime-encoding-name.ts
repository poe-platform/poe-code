import type {ExecutionMeter} from "./execution-budget.js";
import {isUnicodeCharacter} from "./unicode-character-classification.js";

/** Python codec-registry spelling: collapse punctuation, preserve dots, omit
 * non-ASCII alphanumerics, trim edge separators and fold ASCII case. */
export function normalizeRuntimeEncodingName(name:string,meter:ExecutionMeter):string {
  let normalized="",separator=false;
  for(const character of name){
    const point=character.codePointAt(0)!;meter.checkpoint(1,64);
    const asciiLetter=point>=65&&point<=90||point>=97&&point<=122,asciiDigit=point>=48&&point<=57;
    if(asciiLetter||asciiDigit||point===46){
      if(separator&&normalized.length)normalized+="_";
      normalized+=point>=65&&point<=90?String.fromCharCode(point+32):character;separator=false;
    }else if(point>127&&(isUnicodeCharacter(point,"isalpha",meter)||isUnicodeCharacter(point,"isnumeric",meter))){if(separator&&normalized.length)normalized+="_";separator=false;}
    else separator=true;
  }
  return normalized;
}
