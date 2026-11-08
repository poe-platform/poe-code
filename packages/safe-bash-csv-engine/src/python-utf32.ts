import { PythonTextDecodeError } from "./python-codepages.js";
import { PythonTextEncodingError } from "./python-utf16.js";

/** Strict Python incremental UTF32, retaining at most three undecoded bytes. */
export class PythonUtf32Decoder {
 private little: boolean | undefined;
 private carry = new Uint8Array();
 constructor(encoding: "utf-32" | "utf-32-le" | "utf-32-be") {
  this.little = encoding === "utf-32" ? undefined : encoding === "utf-32-le";
 }
 decode(bytes: Uint8Array = new Uint8Array(), options?: {stream?: boolean}): string {
  const word = new Uint8Array(4),view=new DataView(word.buffer);word.set(this.carry);
  let used=this.carry.length,little=this.little,missingSignature=false,text="";
  for(const byte of bytes){
   word[used++]=byte;
   if(used!==4)continue;
   used=0;
   if(little===undefined){
    const signature=view.getUint32(0,true);
    if(signature===0xfeff){little=true;continue;}
    if(signature===0xfffe0000){little=false;continue;}
    little=true;missingSignature=true;
   }
   const point=view.getUint32(0,little);
   if(point>0x10ffff||point>=0xd800&&point<=0xdfff)throw new PythonTextDecodeError("Invalid UTF-32 input");
   text+=String.fromCodePoint(point);
  }
  if(used&&!options?.stream)throw new PythonTextDecodeError("Truncated UTF-32 input");
  // CPython validates the complete chunk before reporting a missing signature.
  // Commit carry and byte order only on success, including after a final call.
  if(missingSignature)throw new PythonTextEncodingError("UTF-32 stream does not start with BOM");
  this.little=little;this.carry=word.slice(0,used);
  return text;
 }
}
