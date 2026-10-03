import {storedImageDecoder} from "./stored-decoder.js";
import {renderTextToStorage} from "./text-storage.js";
import {decodeRawResource,createStoredResource} from "./resource-storage.js";
import {UnsupportedStoredResource} from "./unsupported-storage.js";
import type {ImageByteSource,ImageByteStorage,StoredRgbaImage} from "./png-storage.js";
import type {SharpInputOptions} from "../ast.js";

/** Decode caller-owned ranges into caller-owned backing without acquiring I/O. */
export async function decodeImageToStorage(source:ImageByteSource,storage:ImageByteStorage,signal:AbortSignal,options?:SharpInputOptions):Promise<StoredRgbaImage>{
 signal.throwIfAborted();
 if(options?.text)return renderTextToStorage({...options,text:options.text},storage,signal);
 if(options?.create)return createStoredResource(storage,{...options,create:options.create},signal);
 if(!Number.isSafeInteger(source.size)||source.size<0)throw new RangeError("Invalid image source size");
 if(options?.raw)return decodeRawResource(source,storage,{...options,raw:options.raw},signal);
 const length=Math.min(54,source.size),prefix=await source.read(0,length,{signal});signal.throwIfAborted();
 if(!(prefix instanceof Uint8Array)||prefix.length!==length)throw new Error("Truncated image source");
 const decoder=storedImageDecoder(prefix);if(!decoder)throw new UnsupportedStoredResource();
 return decoder(source,storage,signal,options);
}
