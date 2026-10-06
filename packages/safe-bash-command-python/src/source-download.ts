import type {CommandContext} from 'safe-bash-contracts';
import {dirname,resolvePath} from 'safe-bash-contracts/path';
import {createPythonBuildEnvironment} from './build-environment.js';
import type {PythonPackageOptions} from './provisioning.js';

/** Reuse package authorization, integrity and caller-backed acquisition for source archives. */
export async function downloadPythonSourceArchive(url:URL,path:string,options:PythonPackageOptions,context:CommandContext):Promise<void>{
 const {fs,signal}=context,cacheDirectory=resolvePath(context.cwd,options.cacheDirectory??dirname(path));
 const caps=await fs.capabilitiesFor?.(cacheDirectory,{signal})??fs.capabilities;
 if(!caps.retainedStagingWrite||!caps.retainedStagingCleanup||!caps.retainedRead||!caps.atomicFileStaging||!fs.createStagedFile||!fs.openReadFile||!fs.publishStagedFile||!fs.confineExtraction)throw new Error('Remote Python sources require retained caller storage');
 const output=await fs.confineExtraction([dirname(path)],{signal});
 if(!output.writeStream)throw new Error('Remote Python sources require streaming writes');
 const environment=createPythonBuildEnvironment({...options,cacheDirectory});
 try{
  const start=await environment.prepare({...context,requirements:[],requirementFiles:[]});
  try{
   const expected=new URLSearchParams(url.hash.slice(1)).get('sha256');
   const address=new URL(url);address.hash='';
   const receipt=await environment.dispatch('package-open',[start.session,address.href,expected],context) as {key:string;size:number};
   let consumed=false;
   const bytes=(async function*(){
    for(let offset=0;offset<receipt.size;){
     const chunk=await environment.dispatch('package-read',[start.session,receipt.key,offset,Math.min(65536,receipt.size-offset)],context) as number[];
     if(!chunk.length)throw new Error('Remote Python source ended early');
     offset+=chunk.length;yield Uint8Array.from(chunk);
    }
    consumed=true;
   })();
   try{await output.writeStream(path,bytes,{flag:'wx',mode:0o600,signal});if(!consumed)throw new Error('Remote Python source write ended early');}
   finally{await bytes.return(undefined);}
  }finally{await environment.finish(start);}
 }finally{await environment.dispose();}
}
