import {PagedStorage} from "@poe-code/safe-fs/storage";
import {dirname,type FileSystem} from "@poe-code/safe-fs/contracts";
import type {ImageMetadata,SharpInputOptions} from "./ast.js";
import {withImageSource} from "./image-source.js";
import {UnsupportedStoredResource} from "./codecs/unsupported-storage.js";
import {readImageMetadata} from "./codecs/index.js";
import {readImageMetadataFromSource} from "./codecs/metadata-source.js";

export async function tryImageMetadata(input:string,options:SharpInputOptions):Promise<ImageMetadata|undefined> {
 const signal=options.signal??new AbortController().signal;signal.throwIfAborted();
 const supplied=options.filesystem;if(!supplied?.capabilities || !supplied.openReadFile)return undefined;
 if(options.text || options.create)return readImageMetadata(undefined,options);
 const storage=supplied.open && supplied.removeFileConditional && supplied.stat
  ?new PagedStorage({fs:supplied as FileSystem,cwd:options.workingDirectory??dirname(input),env:{},signal}):undefined;
 let failure:{error:unknown}|undefined,result:ImageMetadata|undefined;
 try {
  result=await withImageSource(input,supplied as FileSystem,signal,source=>readImageMetadataFromSource(source,signal,options,storage));
 } catch(error){failure={error};}
 try {await storage?.close();}catch(error){if(!failure || failure.error instanceof UnsupportedStoredResource)throw error;}
 if(failure && !(failure.error instanceof UnsupportedStoredResource))throw failure.error;
 return result;
}
