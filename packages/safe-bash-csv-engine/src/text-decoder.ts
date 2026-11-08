import { PythonUtf7FileDecoder } from "./python-utf7.js";
import { PythonIso2022Decoder, pythonIso2022Charsets } from "./python-iso2022.js";
import { PythonHzDecoder } from "./python-hz.js";
import { PythonMultibyteDecoder } from "./python-multibyte.js";
import { pythonMultibyteTables } from "./python-multibyte-tables.js";
import { pythonFileCodepages } from "./python-file-codepages.js";
import { PythonUtf32Decoder } from "./python-utf32.js";
import { PythonUtf16Decoder } from "./python-utf16.js";
import { pythonSingleByteCodepages, decodePythonSingleByte, PythonTextDecodeError } from "./python-codepages.js";
import { normalizeEncoding, pythonCodecAliases } from "./python-codec-aliases.js";

/** Existing CSV text codecs shared with Python-style file consumers. Callers
 * feed bounded chunks; this decoder never owns filesystem or payload storage. */
const fileCodepages={...pythonSingleByteCodepages,...pythonFileCodepages};
const utf8Signature=Uint8Array.of(0xef,0xbb,0xbf);
export { PythonUtf7EncodingError } from "./python-utf7.js";
export { PythonIso2022PendingError } from "./python-iso2022.js";
export { PythonTextDecodeError } from "./python-codepages.js";
export class PythonTextDecoder {
 readonly encoding:string;
 private readonly decoder:TextDecoder|PythonUtf7FileDecoder|PythonIso2022Decoder|PythonHzDecoder|PythonUtf16Decoder|PythonUtf32Decoder|PythonMultibyteDecoder;
 private readonly codepoints:readonly number[]|undefined;
 private signatureOffset=0;
 private signatureComplete:boolean;
 constructor(encoding:string){
  const name=normalizeEncoding(encoding);
  const canonical=Object.hasOwn(pythonCodecAliases,name)?pythonCodecAliases[name]:undefined;
  if(canonical===undefined||(!['utf-7','hz','utf-8-sig','utf-8','utf-16','utf-16-le','utf-16-be','utf-32','utf-32-le','utf-32-be'].includes(canonical)&&!Object.hasOwn(pythonIso2022Charsets,canonical)&&!Object.hasOwn(fileCodepages,canonical)&&!Object.hasOwn(pythonMultibyteTables,canonical)))throw new RangeError(`unknown encoding: ${encoding}`);
  this.encoding=canonical;
  this.codepoints=fileCodepages[canonical];
  this.signatureComplete=canonical!=='utf-8-sig';
  this.decoder=canonical==='utf-7'?new PythonUtf7FileDecoder():Object.hasOwn(pythonIso2022Charsets,canonical)?new PythonIso2022Decoder(canonical):canonical==='hz'?new PythonHzDecoder():pythonMultibyteTables[canonical]?new PythonMultibyteDecoder(pythonMultibyteTables[canonical]!):canonical==='utf-16'||canonical==='utf-16-le'||canonical==='utf-16-be'?new PythonUtf16Decoder(canonical):canonical==='utf-32'||canonical==='utf-32-le'||canonical==='utf-32-be'?new PythonUtf32Decoder(canonical):new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
 }
 decode(bytes?:Uint8Array,options?:{stream?:boolean}):string{
  if(this.codepoints)return decodePythonSingleByte(bytes??new Uint8Array(),this.codepoints,this.encoding);
  if(this.decoder instanceof PythonUtf7FileDecoder||this.decoder instanceof PythonIso2022Decoder||this.decoder instanceof PythonHzDecoder||this.decoder instanceof PythonUtf16Decoder||this.decoder instanceof PythonUtf32Decoder||this.decoder instanceof PythonMultibyteDecoder)return this.decoder.decode(bytes,options);
  try{
   let offset=0;
   if(!this.signatureComplete){
    while(offset<(bytes?.length??0)){
     if(bytes![offset]!==utf8Signature[this.signatureOffset]){
      this.signatureComplete=true;
      if(this.signatureOffset)this.decoder.decode(utf8Signature.subarray(0,this.signatureOffset),{stream:true});
      break;
     }
     offset++;this.signatureOffset++;
     if(this.signatureOffset===utf8Signature.length){this.signatureComplete=true;break;}
    }
    // CPython retains a possible initial signature even at final EOF. A final
    // call does not reset that decision or strip a later signature again.
    if(!this.signatureComplete)return '';
   }
   return this.decoder.decode(bytes?.subarray(offset),options);
  }catch{throw new PythonTextDecodeError('Invalid UTF-8 input');}
 }
}
