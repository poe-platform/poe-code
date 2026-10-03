import {withImageSource} from "./image-source.js";
import {renderTextToStorage} from "./codecs/text-storage.js";
import {storedImageDecoder} from "./codecs/stored-decoder.js";
import {decodeRawResource,createStoredResource} from "./codecs/resource-storage.js";
import type {FileSystem} from "@poe-code/safe-fs/contracts";
import type {SharpInputOptions} from "./ast.js";
import type {ImageByteStorage,ImageByteSource,StoredRgbaImage} from "./codecs/png-storage.js";
import {UnsupportedStoredResource} from "./codecs/unsupported-storage.js";
export {UnsupportedStoredResource} from "./codecs/unsupported-storage.js";
/** File resources use the parent's authority and retained version checks. */
export async function readImageResource(input:Uint8Array|string|undefined,options:SharpInputOptions|undefined,fs:FileSystem,storage:ImageByteStorage,signal:AbortSignal):Promise<StoredRgbaImage> {
 signal.throwIfAborted();
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
