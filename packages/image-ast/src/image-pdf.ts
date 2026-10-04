import {PdfValueStorage} from "./pdf-value-storage.js";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {checkLimitInputPixels} from "./limits.js";
import {PdfFileSource,PdfRetainedDocument,PdfError,renderRetainedPagePixels,type PdfRetainedPage} from "@poe-code/pdf-ast";
import {normalizePath,type FileSystem} from "@poe-code/safe-fs/contracts";
import type {ImageByteSource,ImageByteStorage,StoredRgbaImage} from "./codecs/png-storage.js";
import {isPdfBytes} from "./codecs/svg-pdf.js";
import {UnsupportedStoredResource} from "./codecs/unsupported-storage.js";
import type {ImageMetadata,SharpInputOptions} from "./ast.js";

/** File adapter: PDF indexes and encoded input remain in caller-authorized backing. */
async function openPdfImage(source:ImageByteSource,fs:FileSystem,directory:string,signal:AbortSignal,options:SharpInputOptions,storage?:ImageByteStorage){
 signal.throwIfAborted();const settings={...options},size=source.size;
 if(settings.raw)return undefined;
 if(!Number.isSafeInteger(size)||size<0)throw new RangeError("Invalid PDF image source size");
 const length=Math.min(size,1029),prefix=await source.read(0,length,{signal});signal.throwIfAborted();
 if(!(prefix instanceof Uint8Array)||prefix.length!==length)throw new Error("Truncated PDF image source");
 if(!isPdfBytes(prefix))return undefined;
 directory=normalizePath(directory);
 const prospective=`${directory.endsWith("/")?directory:directory+"/"}.pdf-${crypto.randomUUID()}`;
 const capabilities=await fs.capabilitiesFor?.(prospective,{signal,create:true})??fs.capabilities;
 if(!capabilities.retainedRead||!capabilities.retainedStagingWrite||!capabilities.retainedStagingCleanup||!fs.createStagedFile||!fs.openReadFile)throw new UnsupportedStoredResource();
 const chunks=(async function*(){for(let position=0;position<size;position+=16384){signal.throwIfAborted();const length=Math.min(16384,size-position),bytes=await source.read(position,length,{signal});signal.throwIfAborted();if(!(bytes instanceof Uint8Array)||bytes.length!==length)throw new Error("Truncated PDF image source");yield bytes;}})();
 const retained=await PdfFileSource.fromStream(fs,directory,chunks,{signal,chunkBytes:16384,cacheBytes:65536});
 let document:PdfRetainedDocument|undefined;
 const owned=storage?undefined:capabilities.open!==false&&capabilities.randomAccessWrite!==false&&fs.open&&fs.removeFileConditional?new PagedStorage({fs,cwd:directory,env:{},signal},4):new PdfValueStorage(fs,directory,signal);
 const values=storage??owned!;
 const cleanup=async()=>{let failure:{error:unknown}|undefined;try{await document?.close();}catch(error){failure={error};}try{await retained.close();}catch(error){failure??={error};}try{await owned?.close();}catch(error){failure??={error};}if(failure)throw failure.error;};
 try{
  document=await PdfRetainedDocument.open(retained,{fs,directory},{signal,recovery:"repair",compactNumbers:true,compactKeywords:true,chunkBytes:16384,maxNodes:Infinity,maxTokenBytes:Infinity,maxRecursionDepth:Infinity,maxPageTreeDepth:Infinity,xref:{arrayStorage:values,storedArrayKeys:["Index"]},valueArrays:{containerStorage:values,stringStorage:values,storedStringKeys:["ActualText"],arrayStorage:values,storedArrayKeys:["Contents","Annots","Kids","Widths","W","Differences","ON","OFF","OCGs"],storedArrayPaths:[["ExtGState","*","D"]]}});
  let pages=0,selected:PdfRetainedPage|undefined;
  for await(const page of document.pages()){pages++;if(page.index<=Math.max(0,settings.page??0))selected=page;}
  if(!selected)throw new PdfError("E_CAPABILITY","Page index out of bounds: 0");
  const {mediaBox}=await selected.attributes(),density=settings.density??72,scale=density/72;
  const metadata:ImageMetadata={format:"pdf",width:Math.max(1,Math.round(Math.abs(mediaBox[2]-mediaBox[0])*scale)),height:Math.max(1,Math.round(Math.abs(mediaBox[3]-mediaBox[1])*scale)),space:"srgb",channels:4,depth:"uchar",density,hasAlpha:true,pages,pagePrimary:selected.index,size};
  checkLimitInputPixels(metadata.width,metadata.height,settings);return {metadata,page:selected,close:cleanup};
 }catch(error){await cleanup().catch(()=>{});throw error;}
}

export async function tryPdfMetadata(source:ImageByteSource,fs:FileSystem,directory:string,signal:AbortSignal,options:SharpInputOptions,storage?:ImageByteStorage):Promise<ImageMetadata|undefined>{
 const owner=await openPdfImage(source,fs,directory,signal,options,storage);if(!owner)return undefined;
 await owner.close();return owner.metadata;
}

/** File-oriented PDF adapter. Syntax, decoded images, tiles and final pixels all
 * use caller-authorized backing; no encoded-file or page bitmap is collected. */
export async function tryPdfDecode(source:ImageByteSource,storage:ImageByteStorage,fs:FileSystem,directory:string,signal:AbortSignal,options:SharpInputOptions={}):Promise<StoredRgbaImage|undefined>{
 const settings={...options};const owner=await openPdfImage(source,fs,directory,signal,settings,storage);if(!owner)return undefined;
 let failed=false;
 try{
  const rendered=await renderRetainedPagePixels(owner.page,{fs,directory},{signal,scale:(settings.density??72)/72,imageStorage:storage,retainActualText:true,compactNumbers:true,compactKeywords:true,chunkBytes:4096,tileSize:64});
  const {width,height}=rendered,length=width*height*4;checkLimitInputPixels(width,height,settings);
  const position=storage.allocate(length);
  if(!Number.isSafeInteger(position)||position<0||!Number.isSafeInteger(position+length))throw new RangeError("Invalid PDF image backing allocation");
  let written=0;
  for await(const bytes of rendered.pixels){signal.throwIfAborted();if(bytes.length>length-written)throw new Error("Excess PDF raster pixels");await storage.write(position+written,bytes,{signal});signal.throwIfAborted();written+=bytes.length;}
  if(written!==length)throw new Error("Truncated PDF raster pixels");
  return {format:"pdf",width,height,space:"srgb",channels:4,depth:"uchar",density:settings.density??72,hasAlpha:true,isProgressive:false,pages:owner.metadata.pages!,position};
 }catch(error){failed=true;throw error;}
 finally{await owner.close().catch(error=>{if(!failed)throw error;});}
}
