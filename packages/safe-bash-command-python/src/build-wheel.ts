import {FsError} from 'safe-bash-contracts';
import {resolvePath,basename} from 'safe-bash-contracts/path';
import {openPythonPackageFile} from './package-file.js';
import {stagePythonPackage} from './package-download.js';
import type {PythonPackageContext} from './provisioning.js';

export interface PythonBuiltWheel {
 readonly url:string;
 readonly digest:string;
 readonly size:number;
}

export interface PythonWheelArtifact {
 readonly key:string;
 readonly size:number;
 read(offset:number,length:number):Uint8Array|Promise<Uint8Array>;
 close?():Promise<void>;
}

/** Consume a retained wheel (or open a build result) and publish caller-owned bytes. */
export async function publishPythonBuildWheel(source:string|{filename:string;artifact:PythonWheelArtifact},directory:string,maxBytes:number,context:PythonPackageContext):Promise<PythonBuiltWheel> {
 const {fs,signal}=context,settings={signal};
 let artifact=typeof source==='string'?undefined:source.artifact;
 let reading:Promise<Uint8Array>|undefined;
 try{
  signal.throwIfAborted();
  if(maxBytes!==Infinity&&(!Number.isSafeInteger(maxBytes)||maxBytes<0))throw new RangeError('Invalid Python wheel size limit');
  const filename=typeof source==='string'?basename(source):source.filename;
  if(basename(filename)!==filename||!filename.endsWith('.whl')||filename.includes('\\')||filename.includes('\0'))throw new TypeError('Invalid Python build wheel filename');
  const root=await fs.realpath(resolvePath(context.cwd,directory),settings);
  const caps=await fs.capabilitiesFor?.(root,settings)??fs.capabilities;
  if(!fs.confineExtraction||!fs.prepareDirectory||!caps.retainedStagingWrite||!caps.retainedStagingCleanup||!caps.retainedRead||!caps.atomicFileStaging)throw new Error('Python wheel publication requires confined retained atomic staging');
  if(typeof source==='string')artifact=await openPythonPackageFile(context,resolvePath(context.cwd,source),maxBytes);
  if(!artifact)throw new Error('Python wheel publication requires retained source reads');
  if(artifact.size>maxBytes)throw new Error('Canonical package exceeds maxDownloadBytes');
  const retained=artifact;
  const confined=await fs.confineExtraction([root],settings);
  const destination=new Proxy(confined,{get(target,key){
   const owner=key==='openReadFile'?fs:target,value=Reflect.get(owner,key);
   return typeof value==='function'?value.bind(owner):value;
  }});
  const parent=await destination.stat(root,settings),path=resolvePath(root,artifact.key);
  try{await destination.prepareDirectory!(path,{parent,expected:null,mode:0o700,signal});}
  catch(error){if(!(error instanceof FsError)||!['EEXIST','EAGAIN'].includes(error.code))throw error;}
  if((await destination.lstat(path,settings)).type!=='directory')throw new Error('Python wheel publication directory changed');
  const output=resolvePath(path,filename);
  const body=async function*(){for(let offset=0;offset<retained.size;){const bytes=await (reading=Promise.resolve(retained.read(offset,Math.min(65536,retained.size-offset))));if(!bytes.length||bytes.length>Math.min(65536,retained.size-offset))throw new Error('Invalid Python wheel read');offset+=bytes.length;yield bytes;}};
  const published=await stagePythonPackage({...context,fs:destination},path,body(),maxBytes,undefined,key=>{if(key!==retained.key)throw new Error('Built Python wheel integrity mismatch');},()=>output);
  if(!published)throw new Error('Python wheel publication requires retained atomic staging');
  try{return {url:'file://'+output.split('/').map(encodeURIComponent).join('/'),digest:published.key,size:published.size};}
  finally{await published.close();}
 }finally{try{await reading?.catch(()=>{});}finally{await artifact?.close?.();}}
}
