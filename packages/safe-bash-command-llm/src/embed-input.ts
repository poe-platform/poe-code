import { sourceBytes } from './request-source.js';
/** Python text input uses UTF-8 and universal newlines; preserve original binary input separately. */
export async function* embeddingText(source:AsyncIterable<Uint8Array>,signal:AbortSignal):AsyncIterable<Uint8Array>{
 const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
 let carriageReturn=false;
 for await(const bytes of sourceBytes(source,signal)){
  for(let offset=0;offset<bytes.length;offset+=16384){
   signal.throwIfAborted();
   const part=bytes.subarray(offset,offset+16384);decoder.decode(part,{stream:true});
   const output=new Uint8Array(part.length);let length=0;
   for(const byte of part){
    if(byte===10&&carriageReturn){carriageReturn=false;continue;}
    carriageReturn=byte===13;output[length++]=carriageReturn?10:byte;
   }
   if(length)yield output.subarray(0,length);
  }
 }
 decoder.decode();
}
