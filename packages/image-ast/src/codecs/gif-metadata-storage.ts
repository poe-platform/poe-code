import {createImageDelayReader} from "./stored-delay.js";
import type {RetainedImageMetadata,SharpInputOptions} from "../ast.js";
import type {ImageByteSource,ImageByteStorage} from "./png-storage.js";
import {SourceBytes} from "./storage-source.js";
import {gifAnimationSteps,gifMetadataFields,isGifBytes} from "./gif-metadata.js";

export async function scanGifAnimation(reader:SourceBytes,size:number,start:number,onFrame?:(frame:number,delay:number)=>Promise<void>) {
 const steps=gifAnimationSteps(size,start);let next=steps.next();
 while(!next.done){if(typeof next.value==="number")next=steps.next(await reader.at(next.value));else {await onFrame?.(next.value.frame,next.value.delay);next=steps.next();}}
 return next.value;
}

/** Frame delays remain in caller backing. The caller owns both source and storage lifetimes. */
export async function readGifMetadataFromSource(source:ImageByteSource,storage:ImageByteStorage,signal:AbortSignal,options?:SharpInputOptions):Promise<RetainedImageMetadata> {
 signal.throwIfAborted();const captured={...options},reader=new SourceBytes(source,signal,"GIF"),header=new Uint8Array(Math.min(13,source.size));
 for(let i=0;i<header.length;i++)header[i]=(await reader.at(i))??0;
 if(!isGifBytes(header)||header.length<13)throw new Error("Invalid GIF header");
 const start=13+(header[10]!&128?3*(1<<((header[10]!&7)+1)):0),{frames,loop}=await scanGifAnimation(reader,source.size,start);
 const metadata=gifMetadataFields(header[6]!|(header[7]!<<8),header[8]!|(header[9]!<<8),source.size,frames,loop,captured);
 if(!frames)return metadata;
 const position=storage.allocate(frames*4);
 if(!Number.isSafeInteger(position)||position<0||!Number.isSafeInteger(position+frames*4))throw new RangeError("Invalid GIF delay storage");
 const bytes=new Uint8Array(4096),view=new DataView(bytes.buffer);let used=0,written=0;
 const flush=async()=>{signal.throwIfAborted();await storage.write(position+written,bytes.subarray(0,used),{signal});signal.throwIfAborted();written+=used;used=0;};
 await scanGifAnimation(reader,source.size,start,async(_frame,delay)=>{view.setUint32(used,delay,true);used+=4;if(used===bytes.length)await flush();});if(used)await flush();
 return {...metadata,storedDelay:createImageDelayReader(storage,position,frames,signal)};
}
