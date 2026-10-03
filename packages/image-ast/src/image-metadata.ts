import type {FileSystem} from "@poe-code/safe-fs/contracts";
import type {ImageMetadata,SharpInputOptions} from "./ast.js";
import {withImageSource} from "./image-source.js";
import {UnsupportedStoredResource} from "./codecs/unsupported-storage.js";
import {readImageMetadata} from "./codecs/index.js";
import {readImageMetadataFromSource} from "./codecs/metadata-source.js";

export async function tryImageMetadata(input:string,options:SharpInputOptions):Promise<ImageMetadata|undefined> {
 const signal=options.signal??new AbortController().signal;signal.throwIfAborted();
 const supplied=options.filesystem;if(!supplied?.capabilities || !supplied.openReadFile)return undefined;
 if(options.text || options.create)return readImageMetadata(undefined,options);
 try {
  return await withImageSource(input,supplied as FileSystem,signal,source=>readImageMetadataFromSource(source,signal,options));
 } catch(error){if(error instanceof UnsupportedStoredResource)return undefined;throw error;}
}
