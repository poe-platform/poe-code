import {compareIdentity,compareFileVersion,FsError,type FileSystem} from "@poe-code/safe-fs/contracts";
import type {ImageByteSource} from "./codecs/png-storage.js";
import {UnsupportedStoredResource} from "./codecs/unsupported-storage.js";

/** Scope retained identity, version verification and handle cleanup to one source operation. */
export async function withImageSource<T>(input:Uint8Array|string,fs:FileSystem,signal:AbortSignal,read:(source:ImageByteSource)=>Promise<T>):Promise<T> {
 signal.throwIfAborted();
 if(typeof input!=="string") return read({size:input.length,async read(position,length){signal.throwIfAborted();return new Uint8Array(input.subarray(position,position+length));}});
 const capabilities=await fs.capabilitiesFor?.(input,{signal})??fs.capabilities;
 signal.throwIfAborted();if(!capabilities.retainedRead || !fs.openReadFile) throw new UnsupportedStoredResource();
 const handle=await fs.openReadFile(input,{signal});let result:T|undefined,failure:{error:unknown}|undefined;
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
  const image=await read(source),final=await handle.stat({signal});signal.throwIfAborted();
  if(compareIdentity(initial,final)==="distinct" || !compareFileVersion(initial,final)) throw new FsError("EAGAIN",{path:input,message:"Image source changed while decoding"});
  result=image;
 } catch(error) {failure={error};}
 try {await handle.close();} catch(error) {if(!failure || failure.error instanceof UnsupportedStoredResource) throw error;}
 if(failure) throw failure.error;
 return result!;
}
