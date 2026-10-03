import {imageOutputFormat} from "./output-format.js";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {dirname,type FileSystem} from "@poe-code/safe-fs/contracts";
import {readImageResource,UnsupportedStoredResource,type ImageResourceInput} from "./image-resources.js";
import {isStoredImageOperation} from "./ops/storage.js";
import {transformStoredPipeline} from "./ops/storage-pipeline.js";
import {prepareRawOutput} from "./codecs/raw-storage.js";
import {encodeStoredImage,isStoredOutputFormat} from "./image-encode.js";
import type {SharpInputOptions,OutputEncodeOptions,ImageAstNode,OutputInfo} from "./ast.js";

export interface RetainedImageOutput {
 readonly stream:AsyncGenerator<Uint8Array,OutputInfo|undefined>;
 close():Promise<void>;
}

/** The returned lease owns backing even before its encoder is first pulled. */
export async function tryImageStream(input:ImageResourceInput,options:SharpInputOptions,encoding:OutputEncodeOptions,operations:readonly ImageAstNode[],loadedFiles:ReadonlyMap<string,Uint8Array>):Promise<RetainedImageOutput|undefined>{
 if(!operations.every(isStoredImageOperation))return undefined;
 const fs=options.filesystem;if(!fs?.capabilities||!fs.open||!fs.removeFileConditional||!fs.stat)return undefined;
 const signal=options.signal??new AbortController().signal;signal.throwIfAborted();
 const storage=new PagedStorage({fs:fs as FileSystem,cwd:options.workingDirectory??(typeof input==="string"?dirname(input):"."),env:{},signal});
 let failure:unknown;
 try {
  const resources={readImage:(source:ImageResourceInput,resourceOptions:SharpInputOptions|undefined,resourceSignal:AbortSignal)=>readImageResource(source,resourceOptions,fs as FileSystem,storage,resourceSignal,loadedFiles)};
  let image=await resources.readImage(input,options,signal);const format=imageOutputFormat(image.format,encoding.format);
  if(!isStoredOutputFormat(format))throw new UnsupportedStoredResource();
  image=await transformStoredPipeline(image,storage,operations,signal,resources);
  if(format==="raw")image=prepareRawOutput(image,operations);
  signal.throwIfAborted();
  return {stream:encodeStoredImage(image,storage,signal,{...encoding,format}),close:storage.close.bind(storage)};
 }catch(error){failure=error;}
 try{await storage.close();}catch(error){if(failure instanceof UnsupportedStoredResource)throw error;}
 if(failure instanceof UnsupportedStoredResource)return undefined;
 throw failure;
}
