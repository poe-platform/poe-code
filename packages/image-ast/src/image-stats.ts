import {dirname,type FileSystem} from "@poe-code/safe-fs/contracts";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import type {ImageAstNode,ImageStats,SharpInputOptions} from "./ast.js";
import {readImageResource,UnsupportedStoredResource} from "./image-resources.js";
import {isStoredImageOperation} from "./ops/storage.js";
import {transformStoredPipeline} from "./ops/storage-pipeline.js";
import {computeStoredImageStats} from "./ops/stats-storage.js";

export async function tryImageStats(input:string|Uint8Array|undefined,options:SharpInputOptions,operations:readonly ImageAstNode[],loadedFiles:ReadonlyMap<string,Uint8Array>):Promise<ImageStats|undefined> {
 if(!operations.every(isStoredImageOperation)) return undefined;
 const signal=options.signal??new AbortController().signal;
 signal.throwIfAborted();
 const supplied=options.filesystem;
 if(!supplied?.capabilities || !supplied.open || !supplied.removeFileConditional || !supplied.stat) return undefined;
 const fs=supplied as FileSystem;
 const storage=new PagedStorage({fs,cwd:options.workingDirectory??(typeof input==="string"?dirname(input):"."),env:{},signal});
 let failure:{error:unknown}|undefined,result:ImageStats|undefined;
 try {
  const resources={readImage:(source:string|Uint8Array|undefined,resourceOptions:SharpInputOptions|undefined,resourceSignal:AbortSignal)=>readImageResource(typeof source==="string"?loadedFiles.get(source)??source:source,resourceOptions,fs,storage,resourceSignal)};
  const initial=await resources.readImage(input,options,signal);
  const image=await transformStoredPipeline(initial,storage,operations,signal,resources);
  result=await computeStoredImageStats(image,storage,signal);
 } catch(error){failure={error};}
 try {await storage.close();} catch(error){if(!failure || failure.error instanceof UnsupportedStoredResource) throw error;}
 if(failure && !(failure.error instanceof UnsupportedStoredResource)) throw failure.error;
 return result;
}
