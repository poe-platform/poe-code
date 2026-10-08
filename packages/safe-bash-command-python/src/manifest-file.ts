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
 * Publication streams; the compatibility get method still returns owned bytes. */
export function createPythonPackageFileManifestStore({fs,directory}:{readonly fs:FileSystem;readonly directory:string}){
 const root=resolvePath('/',directory);
 const observations=new Map<string,{revision:string;stat:FileStat}>();
 const path=(scope:string)=>{
  if(typeof scope!=='string'||!scope)throw new TypeError('Invalid Python manifest scope');
  return resolvePath(root,bytesToHex(sha256(new TextEncoder().encode(scope)))+'.json');
 };
 return createPythonPackageStreamingManifestStore({
  async get(scope,{signal}){
   signal.throwIfAborted();
   const filename=path(scope),settings={signal};
   let stat:FileStat;
   try{stat=await fs.lstat(filename,settings);}
   catch(error){signal.throwIfAborted();if(error instanceof FsError&&error.code==='ENOENT'){observations.delete(scope);return undefined;}throw error;}
   const file=await openPythonPackageFile({fs,signal,cwd:root},filename,Infinity,stat);
   if(!file)throw new Error('Python manifests require retained caller reads');
   try{
    const bytes=new Uint8Array(file.size);
    for(let offset=0;offset<bytes.length;){const chunk=await file.read(offset,Math.min(65536,bytes.length-offset));bytes.set(chunk,offset);offset+=chunk.length;}
    let observed=observations.get(scope);
    if(!observed||compareIdentity(observed.stat,stat)!=='same'||!compareFileVersion(observed.stat,stat))observed={revision:crypto.randomUUID(),stat};
    observations.set(scope,observed);
    return {revision:observed.revision,bytes};
   }finally{await file.close();}
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
    try{await fs.publishStagedFile({...owned,file:{...owned.file,stat}},filename,{parent:resolution.parent,destination:observed?.stat??null,ancestors:resolution.ancestors,commitGuard:resolution.validate,signal});}
    catch(error){signal.throwIfAborted();if(error instanceof FsError&&['EAGAIN','EEXIST'].includes(error.code))return false;throw error;}
    if(observations.get(scope)===observed)observations.delete(scope);
    return true;
   }finally{try{await owned.cleanup?.remove();}finally{await owned.cleanup?.close();}}
  },
 });
}
