import {splitPythonSourcePath} from './source-archive-path.js';
import type {CommandContext} from 'safe-bash-contracts';
import {resolvePath,dirname} from 'safe-bash-contracts/path';
import {readZipIndexedArchive,decodeZipEntry,type ZipIndexedArchive} from 'safe-bash-zip-engine';
import {DEFAULT_ARCHIVE_LIMITS} from 'safe-bash-io-engine/commands/archive/internal';
import {createArchiveScratchFactory} from 'safe-bash-io-engine/commands/archive/scratch';
import type {openPythonPackageFile} from './package-file.js';

type SourceFile=NonNullable<Awaited<ReturnType<typeof openPythonPackageFile>>>;

/** Match Python's bounded EOF probe and exclude bytes following the ZIP comment. */
export async function pythonSourceZipSize(input:SourceFile):Promise<number|undefined>{
 const tail=new Uint8Array(Math.min(input.size,65558)),start=input.size-tail.length;
 for(let offset=0;offset<tail.length;){const bytes=await input.read(start+offset,tail.length-offset);tail.set(bytes,offset);offset+=bytes.length;}
 const signature=(offset:number)=>tail[offset]===80&&tail[offset+1]===75&&tail[offset+2]===5&&tail[offset+3]===6;
 let end=-1;
 if(tail.length>=22&&signature(tail.length-22)&&tail[tail.length-2]===0&&tail[tail.length-1]===0)end=tail.length-22;
 else for(let offset=tail.length-4;offset>=0;offset--)if(signature(offset)){if(offset+22<=tail.length)end=offset;break;}
 return end<0?undefined:Math.min(input.size,start+end+22+tail[end+20]!+256*tail[end+21]!);
}

/** Consume and retire the retained archive already admitted by the source host. */
export async function extractPythonSourceZipFile(input:SourceFile,directory:string,maxBytes:number,context:CommandContext,zipSize?:number):Promise<void>{
 const {fs,signal}=context;
 const limits={...DEFAULT_ARCHIVE_LIMITS,maxArchiveBytes:maxBytes};
 let scratch:ReturnType<typeof createArchiveScratchFactory>|undefined;
 let archive:ZipIndexedArchive|undefined,primary:unknown,failed=false;
 try{
  scratch=createArchiveScratchFactory({context,limits,operation:action=>Promise.resolve().then(action)},dirname(directory));
  const size=zipSize??await pythonSourceZipSize(input)??input.size;
  archive=await readZipIndexedArchive({...input,size},limits,signal,scratch,{allowUnreferencedData:true});

  let prefix:string|undefined,flatten=true;
  for await(const entry of archive.entries){
   const [part]=splitPythonSourcePath(entry.name);
   if(!part||prefix!==undefined&&part!==prefix){flatten=false;break;}
   prefix=part;
  }
  for await(const entry of archive.entries){
   signal.throwIfAborted();
   const name=flatten?splitPythonSourcePath(entry.name)[1]:entry.name,path=resolvePath(directory,name);
   if(path!==directory&&!path.startsWith(directory+'/'))throw new Error('Source ZIP member escapes the build directory');
   if(path.includes('\0'))throw new Error('Invalid source ZIP member');
   if(!name||name.endsWith('/')||name.endsWith('\\'))await fs.mkdir(path,{recursive:true,mode:0o755,signal});
   else{
    await fs.mkdir(dirname(path),{recursive:true,mode:0o755,signal});
    const bytes=decodeZipEntry(entry,limits,signal);
    let finished=false;
    const observed=(async function*(){yield* bytes;finished=true;})();
    try{
     await fs.writeStream!(path,observed,{flag:'w',mode:entry.mode&0o111?0o755:0o644,signal});
     if(!finished)throw new Error('Source ZIP write ended before consuming its member');
     if(entry.mode&0o111){if(!fs.chmod)throw new Error('Source ZIP executable files require permissions support');await fs.chmod(path,0o755,{signal});}
    }finally{await observed.return(undefined);}
   }
  }
 }catch(error){primary=error;failed=true;}
 {
  const errors:unknown[]=[];
  try{await archive?.close();}catch(error){errors.push(error);}
  try{await scratch?.close();}catch(error){errors.push(error);}
  try{await input.close();}catch(error){errors.push(error);}
  if(errors.length){if(failed)errors.unshift(primary);if(errors.length===1)throw errors[0];throw new AggregateError(errors,'Python source archive cleanup failed');}
  if(failed)throw primary;
 }
}
