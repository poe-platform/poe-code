import {withImageSource,type ImageByteSource} from "@poe-code/image-ast/portable";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {FsError,dirname,compareIdentity,type FileStat,type FileStaging,type FileStagingResolution} from "@poe-code/safe-fs/contracts";
import {resolvePath} from "safe-bash-contracts/path";
import {writeFileOutput} from "safe-bash-contracts/filesystem-output-budget";
import type {CommandContext} from "safe-bash-contracts/command";
import {createIdentifyReader,imageInspectionError,type IdentifyFileInput,type IdentifyInspection} from "./identify-reader.js";
import {performImage,runImageSteps,ImageStorageFailure,type SipsImageBackend} from "./image-backend.js";
import {StoredSipsImages,type SipsPayload,type SipsImage} from "./stored-image-backend.js";
import type {SipsCliResult} from "./index.js";

export interface SipsFileInput extends IdentifyFileInput {readonly registerCleanup?:CommandContext["registerCleanup"];}
export type SipsInputReader=(path:string,mutation:boolean)=>Promise<IdentifyInspection|undefined>;
type FileRunner=(argv:readonly string[],files:Map<string,SipsPayload>,backend:SipsImageBackend<SipsPayload,SipsImage>,read:SipsInputReader)=>Promise<SipsCliResult>;
const missing=(error:unknown):boolean=>error instanceof FsError&&["ENOENT","ENOTDIR","EISDIR","EACCES","EPERM"].includes(error.code);

export async function runSipsFiles(argv:readonly string[],input:SipsFileInput,signal:AbortSignal,run:FileRunner):Promise<SipsCliResult>{
 const fs=input.filesystem,io={signal},context={fs,signal,...(input.registerCleanup?{registerCleanup:input.registerCleanup}:{})};
 const pixels=new PagedStorage({fs,cwd:input.cwd,env:{},signal}),payloads=new PagedStorage({fs,cwd:input.cwd,env:{},signal}),images=new StoredSipsImages(pixels,payloads,signal);
 const files=new Map<string,SipsPayload>(),original=new Map<string,SipsPayload>(),expectations=new Map<string,FileStat|null>(),resolutions=new Map<string,FileStagingResolution>();
 let total=0,inspectedTotal=0,failed=true;
 const charge=(size:number)=>{total+=size;input.inputBudget?.check(total);};
 const inspect=createIdentifyReader({...input,inputBudget:{check(size){charge(size-inspectedTotal);inspectedTotal=size;}}},signal,true);
 const size=(bytes:SipsPayload)=>bytes instanceof Uint8Array?bytes.length:bytes.size;
 const receipt=async(path:string):Promise<FileStat|null>=>{try{return {...await fs.lstat(path,io)};}catch(error){if(error instanceof FsError&&error.code==="ENOENT")return null;throw error;}};
 const prepareOutput=async(path:string,entry:FileStat|null):Promise<FileStagingResolution|undefined>=>{
  const retained=resolutions.get(path);if(retained)return retained;
  if(entry!==null&&entry.type!=="symlink"&&entry.type!=="file"||!fs.prepareStagingResolution)return undefined;
  const capabilities=await fs.capabilitiesFor?.(path,{...io,stagingResolution:true,followFinalSymlink:true})??fs.capabilities;
  if(entry?.type!=="symlink"&&!capabilities.synchronousStagingResolution)return undefined;
  if(!capabilities.synchronousFollowedStagingResolution||!capabilities.guardedStagingPublication||!capabilities.atomicFileStaging||!capabilities.retainedStagingWrite||!capabilities.retainedStagingCleanup||!fs.createStagedFile||!fs.publishStagedFile||!fs.removeStagedFile)return undefined;
  let resolution:FileStagingResolution;
  try{resolution=await fs.prepareStagingResolution(path,{...io,followFinalSymlink:true});}
  catch(error){if(error instanceof FsError&&error.code==="ENOTSUP")return undefined;throw error;}
  if(resolution.destination&&!capabilities.atomicStagedFileMutation)return undefined;
  const target=await fs.capabilitiesFor?.(resolution.path,{...io,stagingAncestry:true})??fs.capabilities;
  if(!target.atomicStagingAncestry)return undefined;
  resolutions.set(path,resolution);return resolution;
 };
 const inspectPayload=async(bytes:SipsPayload):Promise<IdentifyInspection>=>{
  try{const metadata=await runImageSteps(performImage(images.backend.metadata(bytes)),signal),properties=await runImageSteps(performImage(images.backend.readProperties(bytes,metadata.format)),signal);return {metadata,properties,size:size(bytes)};}
  catch(error){signal.throwIfAborted();if(error instanceof FsError)throw error;return {error:imageInspectionError(error)};}
 };
 const read:SipsInputReader=async(path,mutation)=>{
  if(!mutation)return inspect(path,path,undefined,false);
  const pending=files.get(path);if(pending){const initial=original.get(path);if(initial)charge(size(initial));return inspectPayload(pending);}
  const absolute=resolvePath(input.cwd,path);let bytes:SipsPayload;
  try{
   const capabilities=await fs.capabilitiesFor?.(absolute,io)??fs.capabilities;
   if(capabilities?.retainedRead&&fs.openReadFile){
    if(!expectations.has(absolute))expectations.set(absolute,await receipt(absolute));
    await prepareOutput(absolute,expectations.get(absolute)!);
    bytes=await withImageSource(absolute,fs,signal,async source=>{charge(source.size);return images.retain(images.chunks(source));});
   }else{bytes=await fs.readFile(absolute,io);charge(bytes.length);}
  }catch(error){if(missing(error))return undefined;throw error;}
  files.set(path,bytes);original.set(path,bytes);return inspectPayload(bytes);
 };
 const publish=async(path:string,source:ImageByteSource,last:boolean,guards:readonly FileStagingResolution[]):Promise<void>=>{
  const validate=()=>{for(const guard of guards)guard.validate();return true as const;};
  validate();
  let expected=expectations.has(path)?expectations.get(path)!:await receipt(path);
  const followed=expected?.type==="symlink",resolution=await prepareOutput(path,expected);
  if(resolution){resolution.validate();path=resolution.path;expected=resolution.destination;}
  const capabilities=await fs.capabilitiesFor?.(path,io)??fs.capabilities;
  if(resolution&&(!capabilities.guardedStagingPublication||expected!==null&&!capabilities.atomicStagedFileMutation))throw new FsError("ENOTSUP",{path});
  const direct=(!resolution||!followed&&guards.length===1)&&capabilities?.atomicFilePublication&&fs.publishFileConditional;
  const staged=capabilities?.atomicFileStaging&&capabilities.retainedStagingWrite&&capabilities.retainedStagingCleanup&&fs.createStagedFile&&fs.publishStagedFile&&fs.removeStagedFile;
  if(resolution&&!staged)throw new FsError("ENOTSUP",{path});
  if((!direct&&!staged)||expected!==null&&expected.type!=="file"){
   const bytes=await images.materialize(source);if(last)await payloads.close();
   await writeFileOutput(context,bytes,data=>fs.writeFile(path,data,io));return;
  }
  const parent=resolution?.parent??{...await fs.stat(dirname(path),io)};
  if(direct){
   let complete=false;
   const chunks=(async function*(){for await(const bytes of images.chunks(source)){let admitted:Uint8Array|undefined;await writeFileOutput(context,bytes,async bytes=>{admitted=bytes;});if(!admitted)throw new FsError("EIO",{path,message:"Image output budget did not admit data"});yield admitted;}if(last)await payloads.close();complete=true;})();
   try{await fs.publishFileConditional!(path,chunks,{expected,parent,maxBytes:Infinity,signal});if(!complete)throw new FsError("EIO",{path,message:"Image publisher did not consume output"});}
   finally{await chunks.return();}
  }else{
   let staging:FileStaging|undefined,published=false;
   const cleanup=async()=>{
    let failure:unknown;
    if(staging?.cleanup){try{await staging.cleanup.remove();}catch(error){failure=error;}try{await staging.cleanup.close();}catch(error){failure??=error;}}
    else if(staging){try{await fs.removeStagedFile!(staging);}catch(error){failure=error;}}
    if(published&&failure)throw failure;
   };
   try{
    staging=await fs.createStagedFile!(`${dirname(path)}/.sips-${crypto.randomUUID()}`,"output",{type:"file",data:new Uint8Array()},{parent,retainCleanup:true,mode:expected?expected.mode&0o7777:0o666,signal});
    if(!staging.writer||!staging.cleanup)throw new FsError("ENOTSUP",{path,message:"Sips output requires retained staging handles"});
    const writer=staging.writer;for await(const bytes of images.chunks(source))await writeFileOutput(context,bytes,async bytes=>{await writer.write(bytes,io);});
    if(last)await payloads.close();
    const sealed=await writer.finish(io);signal.throwIfAborted();await fs.publishStagedFile!({...staging,file:{...staging.file,stat:sealed}},path,{parent,destination:expected,signal,...(resolution?{ancestors:resolution.ancestors,commitGuard:validate,preserveIdentity:expected!==null}:{})});published=true;
   }finally{await cleanup();}
  }
 };
 const cleanup=async()=>{let failure:unknown;try{await pixels.close();}catch(error){failure=error;}try{await payloads.close();}catch(error){failure??=error;}if(!failed&&failure)throw failure;};
 try{
  const normalized=[...argv];
  for(let index=0;index<normalized.length;index++){
   if(normalized[index]!=="-o"&&normalized[index]!=="--out")continue;
   const target=normalized[index+1];if(!target||target.endsWith("/"))continue;
   try{if((await fs.stat(resolvePath(input.cwd,target),io)).type==="directory")normalized[index+1]=target+"/";}
   catch(error){if(!(error instanceof FsError)||!["ENOENT","ENOTDIR"].includes(error.code))throw error;}
  }
  const result=await run(normalized,files,images.backend,read);
  await pixels.close();
  // Aliased operands were read before publication. Publish the last result once,
  // retaining every operand's guard so an earlier alias cannot hide a race.
  const outputs:{path:string;bytes:SipsPayload;guards:FileStagingResolution[]}[]=[];
  for(const [path,bytes]of files){
   if(original.get(path)===bytes)continue;
   const absolute=resolvePath(input.cwd,path);
   if(bytes instanceof Uint8Array&&!fs.lstat){outputs.push({path:absolute,bytes,guards:[]});continue;}
   const expected=expectations.has(absolute)?expectations.get(absolute)!:await receipt(absolute);
   const resolution=await prepareOutput(absolute,expected),guards=resolution?[resolution]:[];
   if(resolution){
    const prior=outputs.findIndex(output=>output.guards.some(guard=>guard.path===resolution.path||compareIdentity(guard.destination??undefined,resolution.destination??undefined)==="same"));
    if(prior>=0){guards.push(...outputs[prior]!.guards);outputs.splice(prior,1);}
   }
   outputs.push({path:absolute,bytes,guards});
  }
  let lastSource=-1;for(let index=0;index<outputs.length;index++)if(!(outputs[index]!.bytes instanceof Uint8Array))lastSource=index;
  if(lastSource===-1)await payloads.close();
  for(const [index,{path,bytes,guards}]of outputs.entries()){
   if(bytes instanceof Uint8Array&&!fs.lstat){await writeFileOutput(context,bytes,data=>fs.writeFile(path,data,io));continue;}
   const source:ImageByteSource=bytes instanceof Uint8Array?{size:bytes.length,async read(position,length){return bytes.slice(position,position+length);}}:bytes;
   await publish(path,source,index===lastSource,guards);
  }
  failed=false;return result;
 }catch(error){if(error instanceof ImageStorageFailure)throw error.reason;throw error;}finally{await cleanup();}
}
