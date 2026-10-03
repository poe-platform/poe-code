/** Existing CSV text codecs shared with Python-style file consumers. Callers
 * feed bounded chunks; this decoder never owns filesystem or payload storage. */
export class PythonTextDecodeError extends Error {}
export class PythonTextDecoder {
 readonly encoding:string;
 private readonly decoder:TextDecoder;
 constructor(encoding:string){
  this.encoding=encoding.toLowerCase().replaceAll('_','-');
  if(!['utf-8-sig','utf8-sig','utf-8','utf8','ascii','us-ascii','latin1','latin-1','iso-8859-1'].includes(this.encoding))throw new RangeError(`unknown encoding: ${encoding}`);
  this.decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:!['utf-8-sig','utf8-sig'].includes(this.encoding)});
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
  try{return this.decoder.decode(bytes,options);}catch{throw new PythonTextDecodeError('Invalid UTF-8 input');}
 }
}
