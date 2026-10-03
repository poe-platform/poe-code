import {storedImageDecoder} from "./codecs/stored-decoder.js";
import {decodeRawResource} from "./codecs/resource-storage.js";
import type {ImageByteSource} from "./codecs/png-storage.js";
import {readImageResource,type ImageResourceInput} from "./image-resources.js";
import {isStoredImageOperation} from "./ops/storage.js";
import {transformStoredPipeline} from "./ops/storage-pipeline.js";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {dirname,type FileSystem} from "@poe-code/safe-fs/contracts";
import type {ImageMetadata,RetainedImageMetadata,SharpInputOptions,ImageAstNode,OutputEncodeOptions,RgbaImage} from "./ast.js";
import {withImageSource,type RetainedImageInput} from "./image-source.js";
import {UnsupportedStoredResource} from "./codecs/unsupported-storage.js";
import {readImageMetadata} from "./codecs/index.js";
import {readImageMetadataFromSource} from "./codecs/metadata-source.js";

export async function tryInspectImageMetadata<T>(input:ImageResourceInput,options:SharpInputOptions,operations:readonly ImageAstNode[],encoding:OutputEncodeOptions,loadedFiles:ReadonlyMap<string,Uint8Array>|undefined,consume:(metadata:RetainedImageMetadata)=>Promise<T>):Promise<{value:T}|undefined> {
 if(!operations.every(isStoredImageOperation) || (input===undefined&&!options.text&&!options.create))return undefined;
 const joined=input && typeof input==="object" && "inputs" in input?input:undefined;
 const signal=options.signal??new AbortController().signal;signal.throwIfAborted();
 const supplied=options.filesystem;if(!supplied?.capabilities || (typeof input==="string"&&!supplied.openReadFile))return undefined;
 if(!joined&&(options.text || options.create)&&!operations.length)return {value:await consume(readImageMetadata(undefined,options))};
 const storage=supplied.open && supplied.removeFileConditional && supplied.stat
  ?new PagedStorage({fs:supplied as FileSystem,cwd:options.workingDirectory??(typeof input==="string"?dirname(input):"."),env:{},signal}):undefined;
 let failure:{error:unknown}|undefined,result:{value:T}|undefined,consumed=false;
 try {
  const inspect=async(source?:ImageByteSource):Promise<RetainedImageMetadata>=>{
   const generated=options.text||options.create;
   if(joined&&!storage)throw new UnsupportedStoredResource();
   const joinedImage=joined?await readImageResource(joined,options,supplied as FileSystem,storage!,signal,loadedFiles):undefined;
   const metadata=joinedImage?{format:joinedImage.format,width:joinedImage.width,height:joinedImage.height,space:joinedImage.space,channels:joinedImage.channels,depth:joinedImage.depth,density:joinedImage.density,hasAlpha:joinedImage.hasAlpha,...(joinedImage.pages===undefined?{}:{pages:joinedImage.pages}),...(joinedImage.pageHeight===undefined?{}:{pageHeight:joinedImage.pageHeight}),size:joinedImage.width*joinedImage.height*4}:generated?readImageMetadata(undefined,options):await readImageMetadataFromSource(source!,signal,options,storage);
   if(!operations.length)return metadata;
   if(!storage)throw new UnsupportedStoredResource();
   const resources={readImage:(input:string|Uint8Array|undefined,inputOptions:SharpInputOptions|undefined,inputSignal:AbortSignal)=>readImageResource(typeof input==="string"?loadedFiles?.get(input)??input:input,inputOptions,supplied as FileSystem,storage,inputSignal)};
   let initial=joinedImage;
   if(!initial){
   if(generated)initial=await resources.readImage(undefined,options,signal);
   else if(options.raw)initial=await decodeRawResource(source!,storage,{...options,raw:options.raw},signal);
   else {
    const decoder=await storedImageDecoder(source!,signal);
    if(!decoder)throw new UnsupportedStoredResource();
    initial=await decoder(source!,storage,signal,options);
   }
   }
   const evaluated=await transformStoredPipeline(initial,storage,operations,signal,resources);
   return transformedImageMetadata(metadata,evaluated,encoding);
  };
  const metadata=joined||options.text||options.create?await inspect():await withImageSource(input as string|Uint8Array|RetainedImageInput,supplied as FileSystem,signal,inspect);
  signal.throwIfAborted();consumed=true;result={value:await consume(metadata)};
 } catch(error){failure={error};}
 try {await storage?.close();}catch(error){if(!failure || (!consumed&&failure.error instanceof UnsupportedStoredResource))throw error;}
 if(failure && (consumed || !(failure.error instanceof UnsupportedStoredResource)))throw failure.error;
 return result;
}

export function transformedImageMetadata(rawMeta:ImageMetadata,evaluated:Omit<RgbaImage,"data"|"data16">,encoding:OutputEncodeOptions):ImageMetadata {
    return {
      format: encoding.format ?? evaluated.format,
      width: evaluated.width,
      height: evaluated.height,
      space: evaluated.space,
      channels: evaluated.channels,
      depth: evaluated.depth,
      density: encoding.density ?? evaluated.density,
      hasAlpha: evaluated.hasAlpha,
      autoOrient: evaluated.orientation!==undefined && evaluated.orientation>=5 && evaluated.orientation<=8?{width:evaluated.height,height:evaluated.width}:{width:evaluated.width,height:evaluated.height},
      ...(evaluated.orientation !== undefined ? { orientation: evaluated.orientation } : {}),
      ...(rawMeta.pages !== undefined ? { pages: rawMeta.pages } : {}),
      ...(rawMeta.pagePrimary !== undefined ? { pagePrimary: rawMeta.pagePrimary } : {}),
      ...(rawMeta.isProgressive !== undefined ? { isProgressive: rawMeta.isProgressive } : {}),
      ...(rawMeta.size !== undefined ? { size: rawMeta.size } : {})
    };
}
