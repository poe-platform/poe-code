import {createPythonPackageFileManifestStore} from './manifest-file.js';
import {bytesToHex} from 'safe-bash-io-engine/byte-encoding';
import {sha256} from '@noble/hashes/sha2.js';
import {FsError} from 'safe-bash-contracts';
import {dirname} from 'safe-bash-contracts/path';
import type {PythonPackageContext} from './provisioning.js';

/** Weak download caches use the same caller storage fallback as installed wheels. */
export async function createConfiguredPythonManifestStore(context:PythonPackageContext,directory:string,filename:string,maxBytes:number,maxCacheBytes:number|undefined){
 const {fs,signal,cwd}=context;
 let caps;
 for(let path=directory;;path=dirname(path)){
  try{caps=await fs.capabilitiesFor?.(path,{signal,create:true})??fs.capabilities;break;}
  catch(error){if(!(error instanceof FsError)||error.code!=='ENOENT'||path==='/')throw error;}
 }
 const native=caps.atomicFileStaging&&caps.retainedStagingWrite&&caps.retainedStagingCleanup&&caps.guardedStagingPublication&&fs.prepareStagingResolution;
 const root=native?directory:cwd+'/.python-packages/manifests/'+bytesToHex(sha256(new TextEncoder().encode(directory)));
 const store=createPythonPackageFileManifestStore({fs,directory:root,filename,...maxCacheBytes===undefined?{}:{maxCacheBytes}});
 if(!native){
  const stat=async(path:string)=>{try{return await fs.lstat(path,{signal});}catch(error){if(!(error instanceof FsError)||error.code!=='ENOENT')throw error;return undefined;}};
  if(await stat(root+'/'+filename))return store;
  const legacy=await stat(directory+'/'+filename);
  if(!legacy)return store;
  if(legacy.type!=='file'||legacy.size>maxBytes)throw new Error('Invalid legacy Python package manifest');
  if(!fs.readStream)throw new Error('Legacy Python manifest migration requires streaming reads');
  await store.compareAndSetSource!(filename,undefined,fs.readStream(directory+'/'+filename,{signal}),{signal,maxBytes});
 }
 return store;
}
