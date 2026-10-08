import {openPythonPackageFile} from './package-file.js';
import {readBackedPythonManifest} from './manifest-backed.js';
import type {PythonPackageContext} from './provisioning.js';

export const pythonPublicationFile='publication.json';
/** Validate and retain the installer's private output through atomic publication. */
export async function withPythonManifestPublication(context:PythonPackageContext,maxBytes:number,publish:(source:AsyncIterable<Uint8Array>)=>Promise<boolean>):Promise<boolean>{
 const {fs,signal,cwd}=context,path=cwd+'/'+pythonPublicationFile,stat=await fs.lstat(path,{signal});
 if(stat.type!=='file')throw new Error('Invalid Python manifest publication file');
 if(stat.size>maxBytes)throw new Error('Python package manifest exceeds maxManifestBytes');
 const file=await openPythonPackageFile(context,path,maxBytes,stat);
 if(!file)throw new Error('Python manifest publication requires retained caller reads');
 let consumed=false;
 async function* source(){for(let offset=0;offset<file!.size;){const bytes=await file!.read(offset,65536);offset+=bytes.length;yield bytes;}consumed=true;}
 try{
  const snapshot=await readBackedPythonManifest(fs,cwd,signal,source(),false);
  try{if(snapshot.version!==3)throw new Error('Invalid Python manifest publication version');}finally{await snapshot.close();}
  consumed=false;
  const committed=await publish(source());
  signal.throwIfAborted();
  if(committed&&!consumed)throw new Error('Python manifest store returned before consuming its source');
  return committed;
 }finally{await file.close();}
}
