import {readBackedPythonManifest} from './manifest-backed.js';
import {jsonValues} from 'safe-bash-query-engine/input';
import {Budget,resolveJqLimits} from 'safe-bash-query-engine/limits';
import {compareIdentity,compareFileVersion} from '@poe-code/safe-fs/runtime-core';
import {FsError,type FileStat,type FileSystem,type FileStaging} from 'safe-bash-contracts';
import {createBufferedOutput} from 'safe-bash-contracts/io';
import {resolvePath} from 'safe-bash-contracts/path';
import {yieldTurn} from 'safe-bash-contracts/yield';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from 'safe-bash-io-engine/byte-encoding';
import {openPythonPackageFile} from './package-file.js';
import {createPythonPackageStreamingManifestStore} from './manifest.js';

/** Persistent caller-owned manifests with native conditional publication.
 * Publication and structured decoding stream; compatibility get returns owned bytes. */
export function createPythonPackageFileManifestStore({fs,directory,maxCacheBytes=Infinity}:{readonly fs:FileSystem;readonly directory:string;readonly maxCacheBytes?:number}){
 if(maxCacheBytes!==Infinity&&(!Number.isSafeInteger(maxCacheBytes)||maxCacheBytes<1))throw new RangeError('Python manifest maxCacheBytes must be positive');
 const root=resolvePath('/',directory);
 const observations=new Map<string,{revision:string;stat:FileStat}>();
 const path=(scope:string)=>{
  if(typeof scope!=='string'||!scope)throw new TypeError('Invalid Python manifest scope');
  return resolvePath(root,bytesToHex(sha256(new TextEncoder().encode(scope)))+'.json');
 };
 async function read<T>(scope:string,{signal,maxBytes=Infinity}:{signal:AbortSignal;maxBytes?:number},consume:(file:NonNullable<Awaited<ReturnType<typeof openPythonPackageFile>>>)=>Promise<T>){
  signal.throwIfAborted();
  let stat:FileStat;
  try{stat=await fs.lstat(path(scope),{signal});}
  catch(error){signal.throwIfAborted();if(error instanceof FsError&&error.code==='ENOENT'){observations.delete(scope);return undefined;}throw error;}
  if(stat.size>maxBytes)throw new Error('Python package manifest exceeds maxManifestBytes');
  const file=await openPythonPackageFile({fs,signal,cwd:root},path(scope),Infinity,stat);
  if(!file)throw new Error('Python manifests require retained caller reads');
  try{
   const value=await consume(file);
   signal.throwIfAborted();
   let observed=observations.get(scope);
   if(!observed||compareIdentity(observed.stat,stat)!=='same'||!compareFileVersion(observed.stat,stat))observed={revision:crypto.randomUUID(),stat};
   observations.set(scope,observed);
   return {revision:observed.revision,value};
  }finally{await file.close();}
 }
 const store=createPythonPackageStreamingManifestStore({
  async get(scope,options){
   const result=await read(scope,options,async file=>{
    const bytes=new Uint8Array(file.size);
    for(let offset=0;offset<bytes.length;){const chunk=await file.read(offset,Math.min(65536,bytes.length-offset));bytes.set(chunk,offset);offset+=chunk.length;}
    return bytes;
   });
   return result&&{revision:result.revision,bytes:result.value};
  },
  async compareAndSet(scope,expected,source,{signal}){
   signal.throwIfAborted();
   const filename=path(scope),observed=observations.get(scope),settings={signal};
   if(observed?.revision!==expected)return false;
   const caps=await fs.capabilitiesFor?.(root,{signal,create:true})??fs.capabilities;
   if(!caps.atomicFileStaging||!caps.retainedStagingWrite||!caps.retainedStagingCleanup||!caps.guardedStagingPublication||!fs.createStagedFile||!fs.publishStagedFile||!fs.prepareStagingResolution)throw new Error('Python manifests require guarded retained atomic staging');
   await fs.mkdir(root,{recursive:true,signal});
   const resolution=await fs.prepareStagingResolution(filename,settings);
   if(observed?(!resolution.destination||compareIdentity(observed.stat,resolution.destination)!=='same'||!compareFileVersion(observed.stat,resolution.destination)):resolution.destination!==null)return false;
   let stage:FileStaging|undefined;
   for(let attempt=0;attempt<16;attempt++){
    try{stage=await fs.createStagedFile(resolvePath(root,'.python-manifest-'+crypto.randomUUID()),'snapshot',{type:'file',data:new Uint8Array()},{parent:resolution.parent,mode:0o600,retainCleanup:true,signal});break;}
    catch(error){signal.throwIfAborted();if(!(error instanceof FsError)||error.code!=='EEXIST')throw error;}
   }
   if(!stage)throw new Error('Python manifest staging names exhausted');
   const owned=stage;
   try{
    if(!owned.writer||!owned.cleanup)throw new Error('Python manifest staging handles missing');
    const writer=owned.writer;
    const output=createBufferedOutput({async write(bytes){await writer.write(bytes,settings);await yieldTurn(signal);}},signal,65536);
    for await(const bytes of source)await output.write(bytes);
    await output.flush();
    const stat=await writer.finish(settings);
    if(stat.size>maxCacheBytes)throw new RangeError('Python package manifest exceeds maxCacheBytes');
    try{await fs.publishStagedFile({...owned,file:{...owned.file,stat}},filename,{parent:resolution.parent,destination:observed?.stat??null,ancestors:resolution.ancestors,commitGuard:resolution.validate,signal});}
    catch(error){signal.throwIfAborted();if(error instanceof FsError&&['EAGAIN','EEXIST'].includes(error.code))return false;throw error;}
    if(observations.get(scope)===observed)observations.delete(scope);
    return true;
   }finally{try{await owned.cleanup?.remove();}finally{await owned.cleanup?.close();}}
  },
 });
 return {...store,async openSnapshot(scope:string,options:{signal:AbortSignal;maxBytes:number}){
  let snapshot:Awaited<ReturnType<typeof readBackedPythonManifest>>|undefined;
  try{
   const result=await read(scope,options,async file=>snapshot=await readBackedPythonManifest(fs,root,options.signal,{async *[Symbol.asyncIterator](){
    for(let offset=0;offset<file.size;){const bytes=await file.read(offset,Math.min(65536,file.size-offset));offset+=bytes.length;yield bytes;}
   }}));
   return result&&{...result.value,revision:result.revision};
  }catch(error){await snapshot?.close();throw error;}
 },getSnapshot(scope:string,options:{signal:AbortSignal;maxBytes:number}){
  return read(scope,options,async file=>{
   const source={async *[Symbol.asyncIterator](){
    for(let offset=0;offset<file.size;){const bytes=await file.read(offset,Math.min(65536,file.size-offset));offset+=bytes.length;yield bytes;}
   }};
   let value:unknown;
   for await(const item of jsonValues(source,new Budget(resolveJqLimits({maxInputBytes:options.maxBytes}),options.signal),{profile:'javascript'}))value=item;
   return value;
  });
 }};
}
