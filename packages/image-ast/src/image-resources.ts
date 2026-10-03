import {storedImageDecoder} from "./codecs/stored-decoder.js";
import {decodeRawResource,createStoredResource} from "./codecs/resource-storage.js";
import {compareIdentity,compareFileVersion,FsError,type FileSystem} from "@poe-code/safe-fs/contracts";
import type {SharpInputOptions} from "./ast.js";
import type {ImageByteStorage,ImageByteSource,StoredRgbaImage} from "./codecs/png-storage.js";
export class UnsupportedStoredResource extends Error {}
/** File resources use the parent's authority and retained version checks. */
export async function readImageResource(input:Uint8Array|string|undefined,options:SharpInputOptions|undefined,fs:FileSystem,storage:ImageByteStorage,signal:AbortSignal):Promise<StoredRgbaImage> {
 signal.throwIfAborted();
 if(options?.text) throw new UnsupportedStoredResource();
 if(options?.create) return createStoredResource(storage,{...options,create:options.create},signal);
 if(input===undefined) throw new UnsupportedStoredResource();
 const decode=(source:ImageByteSource,prefix:Uint8Array)=>{
  if(options?.raw) return decodeRawResource(source,storage,{...options,raw:options.raw},signal);
  const decoder=storedImageDecoder(prefix);
  if(!decoder) throw new UnsupportedStoredResource();
  return decoder(source,storage,signal,options);
 };
 if(typeof input!=="string") return decode({size:input.length,async read(position,length){signal.throwIfAborted();return new Uint8Array(input.subarray(position,position+length));}},input);
 const capabilities=await fs.capabilitiesFor?.(input,{signal})??fs.capabilities;
 signal.throwIfAborted();if(!capabilities.retainedRead || !fs.openReadFile) throw new UnsupportedStoredResource();
 const handle=await fs.openReadFile(input,{signal});let result:StoredRgbaImage|undefined,failure:{error:unknown}|undefined;
 try {
  signal.throwIfAborted();
  const initial={...await handle.stat({signal})};signal.throwIfAborted();
  if(initial.type!=="file" || !Number.isSafeInteger(initial.size) || initial.size<0) throw new FsError("EINVAL",{path:input});
  const source:ImageByteSource={size:initial.size,async read(position,length){
   const result=new Uint8Array(length);
   for(let offset=0;offset<length;) {
    signal.throwIfAborted();const bytes=await handle.read(position+offset,length-offset,{signal});signal.throwIfAborted();
    if(!(bytes instanceof Uint8Array) || !bytes.length || bytes.length>length-offset) throw new FsError("EIO",{path:input});
    result.set(bytes,offset);offset+=bytes.length;
   }
   return result;
  }};
  const prefix=options?.raw?new Uint8Array():await source.read(0,Math.min(54,initial.size),{signal});
  const image=await decode(source,prefix),final=await handle.stat({signal});signal.throwIfAborted();
  if(compareIdentity(initial,final)==="distinct" || !compareFileVersion(initial,final)) throw new FsError("EAGAIN",{path:input,message:"Image source changed while decoding"});
  result=image;
 } catch(error) {failure={error};}
 try {await handle.close();} catch(error) {if(!failure || failure.error instanceof UnsupportedStoredResource) throw error;}
 if(failure) throw failure.error;
 return result!;
}
