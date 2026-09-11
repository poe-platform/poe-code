import type {SourceMeter} from "./source.js";

/** Explicit legacy future bits survive code compilation, unlike obsolete source
 * directives. nested_scopes is accepted but no longer sets CO_NESTED itself. */
export function normalizeFutureFlags(flags=0,meter?:SourceMeter):number {
  try {
    meter?.checkpoint();
    if(!Number.isSafeInteger(flags)||flags<0||flags>0x1fe0010||(flags&~0x1fe0010)!==0){
      meter?.checkpoint(0,128);
      throw new RangeError("future flags must contain only supported future compiler bits");
    }
    return flags&0x1fe0000;
  } finally {meter?.checkpoint();}
}
