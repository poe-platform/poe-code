import {FsError, type FileStaging} from 'safe-bash-contracts';
import {resolvePath} from 'safe-bash-contracts/path';
import {interruptible} from 'safe-bash-contracts/runtime-control';
import {yieldTurn} from 'safe-bash-contracts/yield';
import {openPythonPackageFile} from './package-file.js';
import type {PythonPackageContext} from './provisioning.js';

let serial=0;

/** Network bodies stage in the caller's filesystem before integrity/publication. */
export async function stagePythonPackage(
 context:PythonPackageContext,directory:string,body:AsyncIterable<Uint8Array>,maxBytes:number,
 progress?:((bytes:number)=>void),verify?:((key:string)=>void),publish?:(key:string)=>string,
){
 const {fs,signal}=context,settings={signal};
 const caps=await fs.capabilitiesFor?.(directory,settings)??fs.capabilities;
 if(!caps.retainedStagingWrite||!caps.retainedStagingCleanup||!caps.retainedRead||!fs.createStagedFile||!fs.openReadFile||publish&&(!caps.atomicFileStaging||!fs.publishStagedFile))return undefined;
 const parent=await fs.stat(directory,settings);
 let stage:FileStaging|undefined;
 for(let attempt=0;attempt<16;attempt++){
  try{stage=await fs.createStagedFile(resolvePath(directory,'.python-package-'+ ++serial),'wheel',{type:'file',data:new Uint8Array(0)},{parent,mode:0o600,retainCleanup:true,signal});break;}
  catch(error){signal.throwIfAborted();if(!(error instanceof FsError)||error.code!=='EEXIST')throw error;}
 }
 if(!stage)throw new Error('Python package staging names exhausted');
 const owner=stage;
 let artifact:Awaited<ReturnType<typeof openPythonPackageFile>>;
 let closing:Promise<void>|undefined;
 const close=()=>closing??=(async()=>{try{await artifact?.close();}finally{try{await owner.cleanup?.remove();}finally{await owner.cleanup?.close();}}})();
 try{
  if(!owner.cleanup||!owner.writer)throw new Error('Python package staging handles missing');
  let count=0;
  const iterator=body[Symbol.asyncIterator]();let ended=false;
  try{while(true){
   const next=await interruptible(Promise.resolve().then(()=>{signal.throwIfAborted();return iterator.next();}),signal);
   signal.throwIfAborted();
   if(next.done){ended=true;break;}
   const bytes=next.value;
   if(!(bytes instanceof Uint8Array))throw new TypeError('Python package body must yield bytes');
   if(count+bytes.length>maxBytes)throw new Error('Package download exceeds maxDownloadBytes');
   for(let offset=0;offset<bytes.length;offset+=65536){
    const chunk=Uint8Array.from(bytes.subarray(offset,offset+65536));
    await owner.writer.write(chunk,settings);count+=chunk.length;await yieldTurn(signal);
   }
   if(bytes.length)progress?.(count);
  }}finally{
   if(!ended){
    const returned=Promise.resolve().then(()=>iterator.return?.());
    if(signal.aborted)void returned.catch(()=>{});else await interruptible(returned,signal);
   }
  }
  const stat=await owner.writer.finish(settings);
  if(stat.size!==count)throw new Error('Python package staging size mismatch');
  artifact=await openPythonPackageFile(context,owner.file.path,maxBytes,stat);
  if(!artifact)throw new Error('Python package retained reads unavailable');
  verify?.(artifact.key);
  if(publish){
   const key=artifact.key,path=publish(key);
   await artifact.close();artifact=undefined;
   let destination=null;
   try{destination=await fs.lstat(path,settings);}catch(error){if(!(error instanceof FsError)||error.code!=='ENOENT')throw error;}
   await fs.publishStagedFile!({...owner,file:{...owner.file,stat}},path,{parent,destination,signal});
   artifact=await openPythonPackageFile(context,path,maxBytes);
   if(!artifact||artifact.key!==key)throw new Error('Published Python package integrity mismatch');
  }
  return {...artifact,close};
 }catch(error){
  try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],error instanceof Error?error.message:"Python package download failed");}
  throw error;
 }
}
