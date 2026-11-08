import {PythonMultibyteDecoder} from './python-multibyte.js';
import {pythonMultibyteTables} from './python-multibyte-tables.js';
import {PythonTextDecodeError} from './python-codepages.js';

/** HZ retains one pending byte and its shift mode across bounded input chunks. */
export class PythonHzDecoder {
 private shifted=false;
 private pending:number|undefined;
 private readonly gb=new PythonMultibyteDecoder(pythonMultibyteTables.gb2312!);
 decode(bytes:Uint8Array=new Uint8Array(),options:{stream?:boolean}={}):string{
  let pending=this.pending,output='';
  // A failed empty flush retains its byte; new input consumes the old buffer.
  if(bytes.length)this.pending=undefined;
  for(const byte of bytes){
   if(pending!==undefined){
    const lead=pending;pending=undefined;
    if(lead===126){
     if(!this.shifted&&byte===123)this.shifted=true;
     else if(this.shifted&&byte===125)this.shifted=false;
     else if(!this.shifted&&byte===126)output+='~';
     else if(!this.shifted&&byte===10)continue;
     else throw new PythonTextDecodeError('Invalid HZ input');
    }else if(this.shifted&&lead>=33&&lead<=125&&byte>=33&&byte<=126){
     output+=this.gb.decode(Uint8Array.of(lead+128,byte+128));
    }else throw new PythonTextDecodeError('Invalid HZ input');
   }else if(byte>=128)throw new PythonTextDecodeError('Invalid HZ input');
   else if(this.shifted||byte===126)pending=byte;
   else output+=String.fromCharCode(byte);
  }
  if(!options.stream&&pending!==undefined)throw new PythonTextDecodeError('Incomplete HZ input');
  this.pending=pending;
  return output;
 }
}
