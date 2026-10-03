import {checkLimitInputPixels} from "./limits.js";
import {PdfFileSource,PdfRetainedDocument,PdfError,type PdfRetainedPage} from "@poe-code/pdf-ast";
import {normalizePath,type FileSystem} from "@poe-code/safe-fs/contracts";
import type {ImageByteSource} from "./codecs/png-storage.js";
import {isPdfBytes} from "./codecs/svg-pdf.js";
import {UnsupportedStoredResource} from "./codecs/unsupported-storage.js";
import type {ImageMetadata,SharpInputOptions} from "./ast.js";

/** File adapter: PDF indexes and encoded input remain in caller-authorized backing. */
export async function tryPdfMetadata(source:ImageByteSource,fs:FileSystem,directory:string,signal:AbortSignal,options:SharpInputOptions):Promise<ImageMetadata|undefined>{
 signal.throwIfAborted();const settings={...options},size=source.size;
 if(settings.raw)return undefined;
 if(!Number.isSafeInteger(size)||size<0)throw new RangeError("Invalid PDF image source size");
 const length=Math.min(size,1029),prefix=await source.read(0,length,{signal});signal.throwIfAborted();
 if(!(prefix instanceof Uint8Array)||prefix.length!==length)throw new Error("Truncated PDF image source");
 if(!isPdfBytes(prefix))return undefined;
 directory=normalizePath(directory);
 const capabilities=await fs.capabilitiesFor?.(directory,{signal,create:true})??fs.capabilities;
 if(!capabilities.retainedRead||!capabilities.retainedStagingWrite||!capabilities.retainedStagingCleanup||!fs.createStagedFile||!fs.openReadFile)throw new UnsupportedStoredResource();
 const chunks=(async function*(){for(let position=0;position<size;position+=16384){signal.throwIfAborted();const length=Math.min(16384,size-position),bytes=await source.read(position,length,{signal});signal.throwIfAborted();if(!(bytes instanceof Uint8Array)||bytes.length!==length)throw new Error("Truncated PDF image source");yield bytes;}})();
 const retained=await PdfFileSource.fromStream(fs,directory,chunks,{signal,chunkBytes:16384,cacheBytes:65536});
 let document:PdfRetainedDocument|undefined,failed=true;
 const cleanup=async()=>{let failure:unknown;try{await document?.close();}catch(error){failure=error;}try{await retained.close();}catch(error){failure??=error;}if(!failed&&failure)throw failure;};
 try{
  document=await PdfRetainedDocument.open(retained,{fs,directory},{signal,recovery:"repair",chunkBytes:16384,maxNodes:Infinity,maxTokenBytes:Infinity,maxRecursionDepth:Infinity,maxPageTreeDepth:Infinity});
  let pages=0,selected:PdfRetainedPage|undefined;
  for await(const page of document.pages()){pages++;if(page.index<=Math.max(0,settings.page??0))selected=page;}
  if(!selected)throw new PdfError("E_CAPABILITY","Page index out of bounds: 0");
  const {mediaBox}=await selected.attributes(),density=settings.density??72,scale=density/72;
  const metadata:ImageMetadata={format:"pdf",width:Math.max(1,Math.round(Math.abs(mediaBox[2]-mediaBox[0])*scale)),height:Math.max(1,Math.round(Math.abs(mediaBox[3]-mediaBox[1])*scale)),space:"srgb",channels:4,depth:"uchar",density,hasAlpha:true,pages,pagePrimary:selected.index,size};
  checkLimitInputPixels(metadata.width,metadata.height,settings);failed=false;return metadata;
 }finally{await cleanup();}
}
