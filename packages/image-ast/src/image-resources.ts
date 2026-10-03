import {joinStoredImages} from "./ops/join-storage.js";
import {withImageSource,type RetainedImageInput} from "./image-source.js";
import {renderTextToStorage} from "./codecs/text-storage.js";
import {storedImageDecoder} from "./codecs/stored-decoder.js";
import {decodeRawResource,createStoredResource} from "./codecs/resource-storage.js";
import type {FileSystem} from "@poe-code/safe-fs/contracts";
import type {SharpInputOptions} from "./ast.js";
import type {ImageByteStorage,ImageByteSource,StoredRgbaImage} from "./codecs/png-storage.js";
import {UnsupportedStoredResource} from "./codecs/unsupported-storage.js";
export {UnsupportedStoredResource} from "./codecs/unsupported-storage.js";
export interface JoinedImageInput {readonly inputs:readonly (Uint8Array|ArrayBuffer|string|SharpInputOptions)[];}
export type ImageResourceInput=Uint8Array|string|JoinedImageInput|RetainedImageInput|undefined;
/** File resources use the parent's authority and retained version checks. */
export async function readImageResource(input:ImageResourceInput,options:SharpInputOptions|undefined,fs:FileSystem,storage:ImageByteStorage,signal:AbortSignal,loadedFiles?:ReadonlyMap<string,Uint8Array>):Promise<StoredRgbaImage> {
 signal.throwIfAborted();
 if(typeof input==="string")input=loadedFiles?.get(input)??input;
 if(input && typeof input==="object" && "inputs" in input){
  const images:StoredRgbaImage[]=[],paths=new Map<string,StoredRgbaImage>();
  for(const item of input.inputs){
   if(typeof item==="string"&&paths.has(item)){images.push(paths.get(item)!);continue;}
   let source:Uint8Array|string|undefined,configured=options;
   if(item instanceof Uint8Array){if(!item.byteLength)throw new Error("Input Bit Array is empty");source=item;}
   else if(item instanceof ArrayBuffer){if(!item.byteLength)throw new Error("Input bit Array is empty");source=new Uint8Array(item);}
   else if(typeof item==="string")source=item.trimStart().startsWith("<")?new TextEncoder().encode(item):item;
   else configured=item;
   const image=await readImageResource(source,configured,fs,storage,signal,loadedFiles);images.push(image);if(typeof item==="string")paths.set(item,image);
  }
  return joinStoredImages(images,storage,signal,options);
 }
 if(options?.text) return renderTextToStorage({...options,text:options.text},storage,signal);
 if(options?.create) return createStoredResource(storage,{...options,create:options.create},signal);
 if(input===undefined) throw new UnsupportedStoredResource();
 const decode=(source:ImageByteSource,prefix:Uint8Array)=>{
  if(options?.raw) return decodeRawResource(source,storage,{...options,raw:options.raw},signal);
  const decoder=storedImageDecoder(prefix);
  if(!decoder) throw new UnsupportedStoredResource();
  return decoder(source,storage,signal,options);
 };
 return withImageSource(input,fs,signal,async source=>decode(source,options?.raw?new Uint8Array():await source.read(0,Math.min(54,source.size),{signal})));
}
