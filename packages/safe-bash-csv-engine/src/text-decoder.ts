/** Existing CSV text codecs shared with Python-style file consumers. Callers
 * feed bounded chunks; this decoder never owns filesystem or payload storage. */
const utf8Signature=Uint8Array.of(0xef,0xbb,0xbf);
export class PythonTextDecodeError extends Error {}
export class PythonTextDecoder {
 readonly encoding:string;
 private readonly decoder:TextDecoder;
 private signatureOffset=0;
 private signatureComplete:boolean;
 constructor(encoding:string){
  this.encoding=encoding.toLowerCase().replaceAll('_','-');
  if(!['utf-8-sig','utf8-sig','utf-8','utf8','ascii','us-ascii','latin1','latin-1','iso-8859-1'].includes(this.encoding))throw new RangeError(`unknown encoding: ${encoding}`);
  this.signatureComplete=!['utf-8-sig','utf8-sig'].includes(this.encoding);
  this.decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
 }
 decode(bytes?:Uint8Array,options?:{stream?:boolean}):string{
  if(['ascii','us-ascii','latin1','latin-1','iso-8859-1'].includes(this.encoding)){
   let text='';
   for(const byte of bytes??[]){
    if((this.encoding==='ascii'||this.encoding==='us-ascii')&&byte>127)throw new PythonTextDecodeError('Invalid ASCII input');
    text+=String.fromCharCode(byte);
   }
   return text;
  }
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
