import {splitPythonSourcePath} from './source-archive-path.js';
import type {ByteSource,CommandContext} from 'safe-bash-contracts';
import {resolvePath,dirname} from 'safe-bash-contracts/path';
import {readArchive} from 'safe-bash-command-tar/extract';
import type {ReadEntry} from 'safe-bash-command-tar/format';
import {parseOptions} from 'safe-bash-command-tar/options';
import {autodetected} from 'safe-bash-command-tar/stream';
import {Budget,DEFAULT_ARCHIVE_LIMITS} from 'safe-bash-io-engine/commands/archive/internal';
import {openPythonPackageFile} from './package-file.js';
import {extractPythonSourceZip} from './source-zip.js';
import {extractPythonSourceZipFile,pythonSourceZipSize} from './source-zip-extract.js';

/** Optional source-archive host capability, using the existing ZIP and tar engines. */
export async function extractPythonSourceArchive(source:string,directory:string,maxBytes:number,context:CommandContext):Promise<void>{
 if(source.toLowerCase().endsWith('.zip'))return extractPythonSourceZip(source,directory,maxBytes,context);
 const {fs,signal}=context,settings={signal};
 if(maxBytes!==Infinity&&(!Number.isSafeInteger(maxBytes)||maxBytes<0))throw new RangeError('Invalid Python source archive size limit');
 if(!fs.confineExtraction||!fs.writeStream)throw new Error('Python tar sources require confined streaming writes');
 const input=await openPythonPackageFile(context,source,maxBytes);
 if(!input)throw new Error('Python tar sources require retained reads');
 let failed=false,primary:unknown,zipSize:number|undefined;
 try{
  zipSize=await pythonSourceZipSize(input);
  if(zipSize===undefined){
   const destination=await fs.confineExtraction([directory],settings);
   const limits=DEFAULT_ARCHIVE_LIMITS;
   const command={...context,args:['-tf','-'],cwd:directory};
   const options=await parseOptions(command,limits);
   if(options==='help')throw new Error('Invalid source tar options');
   const stream=async function*(){for(let offset=0;offset<input.size;){const bytes=await input.read(offset,65536);offset+=bytes.length;yield bytes;}};

   let prefix:string|undefined,flatten=true,members=0;
   await readArchive(command,autodetected(stream(),signal,limits),options,new Budget(command,limits),{async member(entry,reader){
    members++;const [part]=splitPythonSourcePath(entry.name);
    if(!part||prefix!==undefined&&part!==prefix)flatten=false;
    prefix??=part;await reader.discard(entry.size);
   }});
   const target=(name:string)=>{
    const path=resolvePath(directory,flatten?splitPythonSourcePath(name)[1]:name);
    if(path!==directory&&!path.startsWith(directory+'/'))throw new Error('Source tar member escapes the build directory');
    return path;
   };
   const write=async(path:string,bytes:ByteSource,mode:number)=>{
    let finished=false;
    const observed=(async function*(){yield* bytes;finished=true;})();
    try{await destination.writeStream!(path,observed,{flag:'w',mode:0o644,signal});if(!finished)throw new Error('Source tar write ended before consuming its member');}
    finally{await observed.return(undefined);}
    if(mode&0o111){if(!destination.chmod)throw new Error('Source tar executables require permissions support');await destination.chmod(path,0o755,settings);}
   };
   const copyLink=async(name:string,before:number,path:string,mode:number)=>{
    for(let step=0;step<=members;step++){
     let matched:{entry:ReadEntry;start:number;body:number}|undefined;
     await readArchive(command,autodetected(stream(),signal,limits),options,new Budget(command,limits),{async member(entry,reader,_selected,_root,start){
      if(entry.name===name&&start<before)matched={entry,start,body:reader.position};
      await reader.discard(entry.size);
     }});
     if(!matched)throw new Error('Source tar link target was not found');
     const selected=matched;
     if(selected.entry.type==='0'){
      await readArchive(command,autodetected(stream(),signal,limits),options,new Budget(command,limits),{async member(entry,reader){
       if(reader.position===selected.body)await write(path,reader.body(entry.size),mode);else await reader.discard(entry.size);
      }});return;
     }
     if(selected.entry.type==='1'){name=selected.entry.linkname;before=selected.start;}
     else if(selected.entry.type==='2'){name=resolvePath('/',dirname(selected.entry.name),selected.entry.linkname).slice(1);before=Infinity;}
     else throw new Error('Source tar link target is not a file');
    }
    throw new Error('Source tar link cycle');
   };
   await readArchive(command,autodetected(stream(),signal,limits),options,new Budget(command,limits),{async member(entry,reader,_selected,_root,start){
    const path=target(entry.name);
    if(entry.type==='5'){await destination.mkdir(path,{recursive:true,mode:0o755,signal});return;}
    await destination.mkdir(dirname(path),{recursive:true,mode:0o755,signal});
    if(entry.type==='2'){
     const link=resolvePath(dirname(path),entry.linkname);
     if(link!==directory&&!link.startsWith(directory+'/'))throw new Error('Source tar symlink escapes the build directory');
     if(!destination.symlink)throw new Error('Source tar links require symlink support');
     await destination.rm(path,{force:true,signal});await destination.symlink(entry.linkname,path,settings);return;
    }
    if(entry.type==='1')await copyLink(entry.linkname,start,path,entry.mode);
    else await write(path,reader.body(entry.size),entry.mode);
    if(entry.mtime!==undefined){if(!destination.utimes)throw new Error('Source tar files require timestamp support');await destination.utimes(path,entry.mtime*1000,entry.mtime*1000,settings);}
   }});
  }
 }catch(error){primary=error;failed=true;}
 if(!failed&&zipSize!==undefined)return extractPythonSourceZipFile(input,directory,maxBytes,context,zipSize);
 try{await input.close();}catch(error){if(failed)throw new AggregateError([primary,error],'Python source tar cleanup failed');throw error;}
 if(failed)throw primary;
}
