import {PythonTextDecodeError} from './python-codepages.js';

export class PythonUtf7EncodingError extends TypeError {
 constructor(){super('surrogates not allowed');}
}

/** File-oriented UTF-7 decoding. Completed units can be staged before the shift
 * ends; callers must discard that staging if decoding or final UTF8 admission fails.
 * Unlike Python's incremental codec, this never retains an entire shifted segment. */
export class PythonUtf7FileDecoder {
 private shifted=false;
 private haveSextet=false;
 private bits=0;
 private value=0;
 private high:number|undefined;
 private loneSurrogate=false;
 private unit(point:number):string{
  let output='';
  if(this.high!==undefined){
   const high=this.high;this.high=undefined;
   if(point>=0xdc00&&point<=0xdfff)return String.fromCodePoint(0x10000+(high-0xd800)*1024+point-0xdc00);
   this.loneSurrogate=true;output+=String.fromCharCode(high);
  }
  if(point>=0xd800&&point<=0xdbff)this.high=point;
  else{if(point>=0xdc00&&point<=0xdfff)this.loneSurrogate=true;output+=String.fromCharCode(point);}
  return output;
 }
 decode(bytes:Uint8Array=new Uint8Array(),options:{stream?:boolean}={}):string{
  let output='';
  for(const byte of bytes){
   if(this.shifted){
    const sextet=byte>=65&&byte<=90?byte-65:byte>=97&&byte<=122?byte-71:byte>=48&&byte<=57?byte+4:byte===43?62:byte===47?63:-1;
    if(sextet>=0){
     this.haveSextet=true;this.value=(this.value<<6)|sextet;this.bits+=6;
     if(this.bits>=16){this.bits-=16;output+=this.unit(this.value>>>this.bits);this.value&=(1<<this.bits)-1;}
     continue;
    }
    if(!this.haveSextet){if(byte!==45)throw new PythonTextDecodeError('Invalid UTF-7 shift');output+='+';}
    else{
     if(this.bits>=6||this.value!==0)throw new PythonTextDecodeError('Invalid UTF-7 padding');
     if(this.high!==undefined){this.loneSurrogate=true;output+=String.fromCharCode(this.high);this.high=undefined;}
    }
    this.shifted=false;
    if(byte===45)continue;
   }
   if(byte>=128)throw new PythonTextDecodeError('Invalid UTF-7 byte');
   if(byte===43){this.shifted=true;this.haveSextet=false;this.bits=0;this.value=0;}
   else output+=String.fromCharCode(byte);
  }
  if(!options.stream){
   if(this.shifted&&(this.bits>=6||this.value!==0||this.high!==undefined))throw new PythonTextDecodeError('Incomplete UTF-7 shift');
   this.shifted=false;
   // Whole-file decode errors take precedence over UTF8 materialization errors.
   // No staged prefix, including a JS surrogate pair from distinct shifts, escapes.
   if(this.loneSurrogate)throw new PythonUtf7EncodingError();
  }
  return output;
 }
}
