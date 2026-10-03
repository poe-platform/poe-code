import {readProperties,readPropertiesFromSource} from "./properties.js";
import {compareIdentity,compareFileVersion,FsError,type FileSystem} from "@poe-code/safe-fs/contracts";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {resolvePath} from "safe-bash-contracts/path";
import {drainCooperativeSteps} from "safe-bash-contracts/yield";
import {readImageMetadata,decodeImage,computeImageStatsSteps,readImageMetadataFromSource,decodeImageToStorage,computeStoredImageStats,UnsupportedStoredResource,isPdfBytes,isSvgBytes,isHeifBytes,type ImageMetadata,type ImageStats,type SharpInputOptions,type ImageByteSource} from "@poe-code/image-ast/portable";

export interface IdentifyFileInput {
 readonly filesystem:FileSystem;
 readonly cwd:string;
 readonly inputBudget?:{check(bytes:number):void};
}
export type IdentifyInspection={readonly metadata:ImageMetadata;readonly size:number;readonly stats?:ImageStats;readonly properties?:Map<string,string|null>}|{readonly error:unknown};
export type IdentifyReader=(path:string,base:string,page:number|undefined,verbose:boolean)=>Promise<IdentifyInspection|undefined>;
class ReadFailure extends Error {constructor(readonly reason:unknown){super("Image input read failed");}}
const missing=(error:unknown):boolean=>error instanceof FsError&&["ENOENT","ENOTDIR","EISDIR","EACCES","EPERM"].includes(error.code);

export async function inspectIdentifyBytes(bytes:Uint8Array,options:SharpInputOptions|undefined,verbose:boolean,signal?:AbortSignal,properties=false):Promise<IdentifyInspection>{
 try {const metadata=readImageMetadata(bytes,options);return {metadata,size:bytes.length,...(properties?{properties:readProperties(bytes,metadata.format)}:{}),...(verbose?{stats:await drainCooperativeSteps(computeImageStatsSteps(decodeImage(bytes,options)),signal)}:{})};}
 catch(error){signal?.throwIfAborted();return {error};}
}

// Admission alone needs only one recognized brand; the legacy codec determines
// the exact format after the explicitly buffered compatibility read.
async function isRetainedHeif(source:ImageByteSource,prefix:Uint8Array,signal:AbortSignal):Promise<boolean>{
 if(isHeifBytes(prefix))return true;
 if(prefix.length<16||prefix[4]!==102||prefix[5]!==116||prefix[6]!==121||prefix[7]!==112)return false;
 let end=new DataView(prefix.buffer,prefix.byteOffset,prefix.byteLength).getUint32(0,false);
 if(end===0||end>source.size)end=Math.min(source.size,64);
 if(end<16)return false;
 const candidate=new Uint8Array(20);candidate.set(prefix.subarray(0,16));new DataView(candidate.buffer).setUint32(0,20,false);
 for(let position=16;position+4<=end;){
  signal.throwIfAborted();const length=Math.min(16384,Math.floor((end-position)/4)*4),brands=await source.read(position,length,{signal});
  for(let offset=0;offset<brands.length;offset+=4){candidate.set(brands.subarray(offset,offset+4),16);if(isHeifBytes(candidate))return true;}
  position+=length;
 }
 return false;
}

/** One retained source identity covers metadata and optional statistics. */
export function createIdentifyReader(input:IdentifyFileInput,signal:AbortSignal,properties=false):IdentifyReader{
 let total=0;
 return async(_path,base,page,verbose)=>{
  signal.throwIfAborted();const fs=input.filesystem,path=resolvePath(input.cwd,base),options=page===undefined?undefined:{page};
  let capabilities;try{capabilities=await fs.capabilitiesFor?.(path,{signal})??fs.capabilities;}catch(error){if(missing(error))return undefined;throw error;}
  if(!capabilities?.retainedRead||!fs.openReadFile){
   let bytes:Uint8Array;try{bytes=await fs.readFile(path,{signal});}catch(error){if(missing(error))return undefined;throw error;}
   total+=bytes.length;input.inputBudget?.check(total);return inspectIdentifyBytes(bytes,options,verbose,signal,properties);
  }
  let handle;try{handle=await fs.openReadFile(path,{signal});}catch(error){if(missing(error))return undefined;throw error;}
  let failure:{error:unknown}|undefined,result:IdentifyInspection|undefined,storage:PagedStorage|undefined;
  try{
   const initial={...await handle.stat({signal})};signal.throwIfAborted();
   if(initial.type!=="file")throw new FsError("EISDIR",{path});
   if(!Number.isSafeInteger(initial.size)||initial.size<0)throw new FsError("EIO",{path});
   total+=initial.size;input.inputBudget?.check(total);
   const source:ImageByteSource={size:initial.size,async read(position,length){
    const bytes=new Uint8Array(length);
    for(let offset=0;offset<length;){signal.throwIfAborted();let chunk:Uint8Array;try{chunk=await handle.read(position+offset,length-offset,{signal});}catch(error){throw new ReadFailure(error);}signal.throwIfAborted();if(!(chunk instanceof Uint8Array)||!chunk.length||chunk.length>length-offset)throw new ReadFailure(new FsError("EIO",{path}));bytes.set(chunk,offset);offset+=chunk.length;}
    return bytes;
   }};
   storage=new PagedStorage({fs,cwd:input.cwd,env:{},signal});
   try{
    const prefix=await source.read(0,Math.min(1029,source.size),{signal});
    if(isPdfBytes(prefix)||isSvgBytes(prefix)||await isRetainedHeif(source,prefix,signal)){
     // These convenience codecs are still migrated by their format owners.
     const bytes=new Uint8Array(source.size);for(let offset=0;offset<bytes.length;offset+=16384)bytes.set(await source.read(offset,Math.min(16384,bytes.length-offset),{signal}),offset);
     result=await inspectIdentifyBytes(bytes,options,verbose,signal,properties);
    }else{
     const {storedDelay:ignoredDelay,...metadata}=await readImageMetadataFromSource(source,signal,options,storage);
     const stats=verbose?await computeStoredImageStats(await decodeImageToStorage(source,storage,signal,options),storage,signal):undefined;
     result={metadata,size:source.size,...(stats?{stats}:{}),...(properties?{properties:await readPropertiesFromSource(source,metadata.format,signal)}:{})};
    }
   }catch(error){signal.throwIfAborted();if(error instanceof ReadFailure)throw error.reason;if(error instanceof FsError)throw error;result={error:error instanceof UnsupportedStoredResource?new Error("Input buffer contains unsupported image format"):error};}
   const final=await handle.stat({signal});signal.throwIfAborted();
   if(compareIdentity(initial,final)==="distinct"||!compareFileVersion(initial,final))throw new FsError("EAGAIN",{path,message:"Image source changed while inspecting"});
  }catch(error){failure={error};}
  finally{
   try{await storage?.close();}catch(error){failure??={error};}
   try{await handle.close();}catch(error){failure??={error};}
  }
  if(failure){if(missing(failure.error))return undefined;throw failure.error;}return result;
 };
}
