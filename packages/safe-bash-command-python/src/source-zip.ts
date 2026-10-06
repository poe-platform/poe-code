import type {CommandContext} from 'safe-bash-contracts';
import {resolvePath,dirname} from 'safe-bash-contracts/path';
import {readZipIndexedArchive,decodeZipEntry,type ZipIndexedArchive} from 'safe-bash-zip-engine';
import {DEFAULT_ARCHIVE_LIMITS} from 'safe-bash-io-engine/commands/archive/internal';
import {createArchiveScratchFactory} from 'safe-bash-io-engine/commands/archive/scratch';
import {openPythonPackageFile} from './package-file.js';

/** Extract a source ZIP into an owned, confined build directory using pip's flattening policy. */
export async function extractPythonSourceZip(source:string,directory:string,maxBytes:number,context:CommandContext):Promise<void>{
 const {fs,signal}=context;
 if(maxBytes!==Infinity&&(!Number.isSafeInteger(maxBytes)||maxBytes<0))throw new RangeError('Invalid Python source archive size limit');
 if(!fs.writeStream)throw new Error('Python source archives require streaming writes');
 const input=await openPythonPackageFile(context,source,maxBytes);
 if(!input)throw new Error('Python source archives require retained reads');
 const limits={...DEFAULT_ARCHIVE_LIMITS,maxArchiveBytes:maxBytes};
 const scratch=createArchiveScratchFactory({context,limits,operation:action=>Promise.resolve().then(action)},dirname(directory));
 let archive:ZipIndexedArchive|undefined,primary:unknown,failed=false;
 try{
  archive=await readZipIndexedArchive(input,limits,signal,scratch,{allowUnreferencedData:true});
  const split=(name:string):[string,string]=>{
   while(name.startsWith('/'))name=name.slice(1);
   while(name.startsWith('\\'))name=name.slice(1);
   const slash=name.indexOf('/'),backslash=name.indexOf('\\');
   const at=slash<0?backslash:backslash<0?slash:Math.min(slash,backslash);
   return at<0?[name,'']:[name.slice(0,at),name.slice(at+1)];
  };
  let prefix:string|undefined,flatten=true;
  for await(const entry of archive.entries){
   const [part]=split(entry.name);
   if(!part||prefix!==undefined&&part!==prefix){flatten=false;break;}
   prefix=part;
  }
  for await(const entry of archive.entries){
   signal.throwIfAborted();
   const name=flatten?split(entry.name)[1]:entry.name,path=resolvePath(directory,name);
   if(path!==directory&&!path.startsWith(directory+'/'))throw new Error('Source ZIP member escapes the build directory');
   if(path.includes('\0'))throw new Error('Invalid source ZIP member');
   if(!name||name.endsWith('/')||name.endsWith('\\'))await fs.mkdir(path,{recursive:true,mode:0o755,signal});
   else{
    await fs.mkdir(dirname(path),{recursive:true,mode:0o755,signal});
    const bytes=decodeZipEntry(entry,limits,signal);
    let finished=false;
    const observed=(async function*(){yield* bytes;finished=true;})();
    try{
     await fs.writeStream(path,observed,{flag:'w',mode:entry.mode&0o111?0o755:0o644,signal});
     if(!finished)throw new Error('Source ZIP write ended before consuming its member');
     if(entry.mode&0o111){if(!fs.chmod)throw new Error('Source ZIP executable files require permissions support');await fs.chmod(path,0o755,{signal});}
    }finally{await observed.return(undefined);}
   }
  }
 }catch(error){primary=error;failed=true;}
 {
  const errors:unknown[]=[];
  try{await archive?.close();}catch(error){errors.push(error);}
  try{await scratch.close();}catch(error){errors.push(error);}
  try{await input.close();}catch(error){errors.push(error);}
  if(errors.length){if(failed)errors.unshift(primary);if(errors.length===1)throw errors[0];throw new AggregateError(errors,'Python source archive cleanup failed');}
  if(failed)throw primary;
 }
}
