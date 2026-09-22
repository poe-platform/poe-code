import {UploadError} from './upload-protocol.js';

/** HTTP framing promises an exact byte count even when the underlying canonical
 * file remains live. Early canonical EOF is valid filesystem evidence, but must
 * not become successful delivery of a longer advertised HTTP body. */
export function exactByteBody(body:ReadableStream<Uint8Array>,length:bigint):ReadableStream<Uint8Array> {
 if(typeof length!=='bigint'||length<0n||length>9223372036854775807n)throw new TypeError('Invalid HTTP byte length');
 let remaining=length;const reader=body.getReader();let retirement:Promise<void>|undefined;
 function retire(reason?:unknown):Promise<void>{
  retirement??=(async()=>{try{await reader.cancel(reason);}finally{reader.releaseLock();}})();return retirement;
 }
 return new ReadableStream<Uint8Array>({
  async pull(controller){
   try {
   const {value:bytes,done}=await reader.read();
   if(done){if(remaining!==0n)throw new UploadError(503,'Incomplete HTTP byte body');controller.close();await retire();return;}
   if(!(bytes instanceof Uint8Array))throw new UploadError(503,'Invalid HTTP byte body');
   const span=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength')!.get!.call(bytes) as number;
   if(BigInt(span)>remaining)throw new UploadError(503,'HTTP byte body exceeds the admitted length');
   // Delivery outlives this pull. Advancing or retiring the canonical producer
   // may reuse its frame, so retain owned bytes after admitting their span.
   remaining-=BigInt(span);controller.enqueue(new Uint8Array(bytes));
   }catch(error){controller.error(error);await retire(error).catch(()=>{});}
  },
  cancel:retire,
 },{highWaterMark:0});
}
