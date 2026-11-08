import type {ImageDelayReader} from "../ast.js";
import type {ImageByteStorage} from "./png-storage.js";

/** Serialize borrowed reads so concurrent consumers cannot overwrite one another's values. */
export function createImageDelayReader(storage:ImageByteStorage,position:number,length:number,signal:AbortSignal):ImageDelayReader {
 let pending:Promise<void>=Promise.resolve();
 return {length,async at(index,options){
  const reading=options?.signal?AbortSignal.any([signal,options.signal]):signal;reading.throwIfAborted();
  if(!Number.isSafeInteger(index)||index<0||index>=length)return undefined;
  const result=pending.then(async()=>{
   reading.throwIfAborted();const bytes=await storage.read(position+index*4,4,{signal:reading});reading.throwIfAborted();
   if(!(bytes instanceof Uint8Array)||bytes.length!==4)throw new Error("Truncated GIF backing storage");
   return new DataView(bytes.buffer,bytes.byteOffset,4).getUint32(0,true);
  });
  pending=result.then(()=>undefined,()=>undefined);return result;
 }};
}
